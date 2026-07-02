import {
  env,
  pipeline,
  type AutomaticSpeechRecognitionOutput,
  type AutomaticSpeechRecognitionPipeline,
} from '@huggingface/transformers'
import { extractPcm } from './audio'
import type { Segment } from './types'
import { vendorUrl } from './vendor'
import type { StatusCallback } from './ocr'

// Model weights come from the Hugging Face Hub (cached by the browser after
// the first download); the ONNX runtime itself is served from our origin.
env.allowLocalModels = false
if (env.backends.onnx?.wasm) {
  env.backends.onnx.wasm.wasmPaths = vendorUrl('ort/')
}

export interface WhisperModelOption {
  id: string
  label: string
}

export const WHISPER_MODELS: WhisperModelOption[] = [
  { id: 'Xenova/whisper-tiny', label: 'Whisper tiny（約40MB・高速・低精度）' },
  { id: 'Xenova/whisper-base', label: 'Whisper base（約60MB・バランス）' },
  { id: 'Xenova/whisper-small', label: 'Whisper small（約190MB・高精度・低速）' },
]
export const DEFAULT_WHISPER_MODEL = 'Xenova/whisper-base'

let current: {
  modelId: string
  promise: Promise<AutomaticSpeechRecognitionPipeline>
} | null = null
let onStatus: StatusCallback = () => {}

function progressToMessage(p: unknown): string | null {
  const info = p as { status?: string; file?: string; progress?: number }
  switch (info.status) {
    case 'progress':
      return `音声認識モデルをダウンロード中: ${info.file ?? ''} ${Math.round(info.progress ?? 0)}%`
    case 'initiate':
    case 'download':
      return `音声認識モデルを取得中: ${info.file ?? ''}`
    case 'ready':
      return '音声認識モデルの準備完了'
    default:
      return null
  }
}

function loadTranscriber(modelId: string): Promise<AutomaticSpeechRecognitionPipeline> {
  if (current?.modelId === modelId) return current.promise
  const options = {
    dtype: 'q8',
    progress_callback: (p: unknown) => {
      const msg = progressToMessage(p)
      if (msg) onStatus(msg)
    },
  } as const
  const promise = (async () => {
    if ('gpu' in navigator) {
      try {
        return await pipeline('automatic-speech-recognition', modelId, {
          ...options,
          device: 'webgpu',
        })
      } catch {
        onStatus('WebGPU での初期化に失敗、WASM にフォールバックします')
      }
    }
    return pipeline('automatic-speech-recognition', modelId, {
      ...options,
      device: 'wasm',
    })
  })().catch((e) => {
    // Allow a retry on the next item instead of caching the failure forever.
    current = null
    throw e
  })
  current = { modelId, promise }
  return promise
}

export interface TranscriptionResult {
  text: string
  segments: Segment[]
}

export async function transcribeMedia(
  blob: Blob,
  modelId: string,
  statusCallback: StatusCallback,
): Promise<TranscriptionResult> {
  onStatus = statusCallback
  statusCallback('音声トラックを抽出中…')
  const pcm = await extractPcm(blob)

  let transcriber: AutomaticSpeechRecognitionPipeline
  try {
    transcriber = await loadTranscriber(modelId)
  } catch (e) {
    throw new Error(
      `音声認識モデルを取得できませんでした。ネットワーク接続を確認して「再認識」をお試しください（${
        e instanceof Error ? e.message : String(e)
      }）`,
    )
  }
  statusCallback('文字起こしを実行中…（長い動画ほど時間がかかります）')
  const output = (await transcriber(pcm, {
    chunk_length_s: 30,
    stride_length_s: 5,
    return_timestamps: true,
  })) as AutomaticSpeechRecognitionOutput

  const segments: Segment[] = (output.chunks ?? [])
    .map((c) => ({
      start: c.timestamp?.[0] ?? 0,
      end: c.timestamp?.[1] ?? c.timestamp?.[0] ?? 0,
      text: c.text.trim(),
    }))
    .filter((s) => s.text.length > 0)

  return { text: output.text.trim(), segments }
}
