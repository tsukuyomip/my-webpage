import type { Shot } from '../lib/types'
import { Thumb } from './Thumb'

export function ShotGrid({ shots, onOpen }: { shots: Shot[]; onOpen: (shot: Shot) => void }) {
  return (
    <ul className="grid">
      {shots.map((shot) => (
        <li key={shot.id}>
          <button className="cell" onClick={() => onOpen(shot)}>
            <Thumb id={shot.id} alt={shot.fileName} />
          </button>
        </li>
      ))}
    </ul>
  )
}
