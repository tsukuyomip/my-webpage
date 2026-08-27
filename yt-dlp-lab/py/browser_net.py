"""ブラウザの中で yt-dlp にネットワークをやらせるための層。

yt-dlp の通信は urllib / requests / curl_cffi のいずれかが担当していて、どれも
「ソケットを掴む」実装になっている。wasm にソケットはないので、そのままでは
どのハンドラも使えない。

幸い yt-dlp のネットワークは register_rh で差し替えられる公開 API になっている
ので、ブラウザ自身の XMLHttpRequest に丸投げするハンドラを1枚被せる。

JS 側は globalThis.ydlSyncFetch(specJson) -> {meta, body} を実装する。名前に先頭
二重アンダースコアを使わないのは、クラス本体の中では属性名がマングルされるため。

同期 XHR を使うのは、yt-dlp 側の API が同期だから。同期 XHR はメインスレッドだと
UI を固めるうえ responseType も指定できないが、Worker の中でなら arraybuffer 込みで
正規に使える。このモジュールは Worker で動くことを前提にしている。
"""

from __future__ import annotations

import base64
import io
import json

import js

from yt_dlp.networking import Response
from yt_dlp.networking.common import RequestHandler, register_preference, register_rh
from yt_dlp.networking.exceptions import HTTPError, TransportError

# XHR が代入を黙って無視するヘッダ。送ったつもりで挙動が変わるのを避けるため、
# こちら側で明示的に落としておく。ここに入っているものはブラウザの値が使われる。
FORBIDDEN_HEADERS = {
    'accept-charset', 'accept-encoding', 'access-control-request-headers',
    'access-control-request-method', 'connection', 'content-length', 'cookie',
    'cookie2', 'date', 'dnt', 'expect', 'host', 'keep-alive', 'origin',
    'referer', 'set-cookie', 'te', 'trailer', 'transfer-encoding', 'upgrade',
    'user-agent', 'via',
}

# 本文はブラウザが展開済みで渡してくる。これらが残っていると yt-dlp が
# 「まだ圧縮されている」と誤解するので、レスポンスヘッダから外す。
STRIPPED_RESPONSE_HEADERS = {'content-encoding', 'content-length'}


# ブラウザのログイン Cookie を同一オリジン外にも送るか。既定は送らない。
# 詳細と注意点は yt-dlp-lab/README.md を参照。
SEND_CREDENTIALS = False


def _request_body(data) -> str | None:
    """リクエスト本文を base64 にする。JS 境界を跨ぐ型を文字列だけに絞るため。"""
    if data is None:
        return None
    if hasattr(data, 'read'):
        data = data.read()
    elif not isinstance(data, (bytes, bytearray)):
        data = b''.join(data)
    return base64.b64encode(bytes(data)).decode('ascii')


@register_rh
class BrowserRH(RequestHandler):
    RH_NAME = 'browser'
    _SUPPORTED_URL_SCHEMES = ('http', 'https')
    # プロキシも impersonate も、ブラウザ越しでは手が出ない。
    _SUPPORTED_PROXY_SCHEMES = None
    _SUPPORTED_FEATURES = ()

    def _prepare_headers(self, request, headers):
        # Accept-Encoding は付けない。ブラウザが自分の対応状況を送り、
        # 展開まで済ませて返してくる。
        for name in list(headers):
            if name.lower() in FORBIDDEN_HEADERS:
                del headers[name]

    def _send(self, request):
        spec = {
            'method': request.method,
            'url': request.url,
            'headers': dict(self._get_headers(request)),
            'body': _request_body(request.data),
            'credentials': SEND_CREDENTIALS,
        }

        result = js.ydlSyncFetch(json.dumps(spec))
        meta = json.loads(result.meta)

        if meta.get('error'):
            # CORS で弾かれた場合もネットワーク層のエラーとしてここに来る。
            # XHR は理由を教えてくれないので、原因の切り分けは呼び出し側の仕事。
            raise TransportError(meta['error'])

        headers = {
            k: v for k, v in meta['headers'].items()
            if k.lower() not in STRIPPED_RESPONSE_HEADERS
        }
        body = bytes(result.body.to_py()) if result.body is not None else b''

        response = Response(
            fp=io.BytesIO(body),
            url=meta['url'],
            headers=headers,
            status=meta['status'],
        )
        if not 200 <= response.status < 300:
            raise HTTPError(response)
        return response


@register_preference(BrowserRH)
def browser_preference(rh, request):
    # 同居している Urllib ハンドラは wasm では必ず失敗するので、確実に上回らせる。
    return 1000
