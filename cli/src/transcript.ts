import type { SceneView, TurnResponse } from '@overstory/sprout-core';

// A turn's answer as the terminal prints it (the split proposal §7.3,
// as Overstory's transcript does): core's lines, one channel per fact.
// A `room` line is the block core wrote on arrival — its name first,
// then paragraphs — followed by the ways on from the scene it came
// with; what was said, asked, missed or refused reads as the room
// speaking; a notice is someone else's move, set off with a mark; an
// `effect` that shows a picture names it, since a terminal cannot open
// one. A poll's answer (`look`) prints only what others did.

function waysOn(scene: SceneView): string {
  return scene.exits.length > 0
    ? `Ways on: ${scene.exits.map((e) => e.label).join('; ')}.`
    : 'No way on from here.';
}

/** The lines to print for one answer. */
export function renderTurn(res: TurnResponse): string[] {
  const out: string[] = [];
  for (const line of res.lines) {
    switch (line.kind) {
      case 'room': {
        const [name, ...rest] = line.text.split(/\n\s*\n/);
        out.push('', `== ${name ?? ''} ==`);
        for (const p of rest) out.push('', p);
        if (res.scene) out.push('', waysOn(res.scene));
        break;
      }
      case 'notice':
        out.push(`* ${line.text}`);
        break;
      case 'effect': {
        const e = line.effect as { kind?: string; mediaId?: unknown } | undefined;
        if (e?.kind === 'show') out.push(`[a picture opens: ${String(e.mediaId)}]`);
        break;
      }
      default:
        out.push(line.text);
    }
  }
  return out;
}
