import {
  pollView,
  type CommandExit,
  type InstanceId,
  type SeenFiller,
  type SeenOptions,
  type SeenReading,
  type SeenThing,
} from '@overstory/sprout/lang';

import { pathOf, type Standing } from '@overstory/sprout-player';

// `sprout view`: what a visitor standing somewhere is shown and offered,
// as a poll gives it (the spec's The runtime › The view): the place's
// description rendered for them, the ways out that apply, who else is
// there, what they carry, and every reading they could make with its
// consent pass's answer, what fills each of its roles and the options of
// each value role. A poll that
// faults is shown as the visitor would see it, then the fault the host
// would log.

/** What polling gave: the page, and whether the poll ran without a fault. */
export interface InspectedView {
  readonly ok: boolean;
  readonly page: string;
}

function section(title: string, lines: readonly string[], none: string): string {
  const body = lines.length === 0 ? [none] : lines;
  return `${title}\n${body.map((line) => `  ${line}\n`).join('')}`;
}

function exitWritten(exit: CommandExit, world: InstanceId): string {
  const way = exit.direction === null ? 'link' : `exit ${exit.direction}`;
  return `${way} "${exit.label}" -> ${pathOf(world, exit.to)}`;
}

function thingWritten(thing: SeenThing, world: InstanceId): string {
  return `${thing.name} (${pathOf(world, thing.id)})`;
}

function optionsWritten(options: SeenOptions): string {
  if (options.takes === 'symbol') {
    const words = options.options.map((one) => one.words);
    return `${options.role}: ${words.length === 0 ? 'nothing it hears' : words.join(', ')}`;
  }
  const ranges = options.ranges.map((range) =>
    range.min === range.max ? `${range.min}` : `${range.min} to ${range.max}`,
  );
  return `${options.role}: ${ranges.length === 0 ? 'nothing it hears' : ranges.join(', ')}`;
}

function fillerWritten(filler: SeenFiller, world: InstanceId): string {
  switch (filler.binds) {
    case 'object':
      return `${filler.role}: ${thingWritten(filler, world)}`;
    case 'set':
      return `${filler.role}: ${filler.ids.map((id, at) => `${filler.names[at]} (${pathOf(world, id)})`).join(', ')}`;
    case 'exit':
      return `${filler.role}: ${exitWritten(filler, world)}`;
    case 'unbound':
      return `${filler.role}: unbound`;
  }
}

/** Whether `filler` is a value role, whose options are written beside the reading instead. */
function valueRole(filler: SeenFiller, options: readonly SeenOptions[]): boolean {
  return filler.binds === 'unbound' && options.some((one) => one.role === filler.role);
}

function readingWritten(reading: SeenReading, world: InstanceId): string[] {
  const refused =
    reading.refused === null ? [] : reading.refused.map((line) => `  refused: ${line}`);
  return [
    `${reading.typed}  (${reading.verb})`,
    ...refused,
    ...reading.fillers
      .filter((filler) => !valueRole(filler, reading.options))
      .map((filler) => `  ${fillerWritten(filler, world)}`),
    ...reading.options.map((options) => `  ${optionsWritten(options)}`),
  ];
}

/** The view of the visitor `standing` holds, polled from where they stand, as a page. */
export function inspectView(standing: Standing): InspectedView {
  const { state, host, visit, place } = standing;
  const world = state.world;
  const { view, fault } = pollView(state, host, visit);
  const page = [
    `standing in ${pathOf(world, place)}\n`,
    section('description', view.description, '(it renders nothing)'),
    ...(view.effects.length === 0
      ? []
      : [
          section(
            'effects',
            view.effects.map(
              (effect) =>
                `${effect.extension}.${effect.statement} ${JSON.stringify(effect.payload)} reads ${effect.transcript}`,
            ),
            'none',
          ),
        ]),
    section(
      'ways out',
      view.exits.map((exit) => exitWritten(exit, world)),
      'none',
    ),
    section(
      'who else is here',
      view.occupants.map((thing) => thingWritten(thing, world)),
      'nobody',
    ),
    section(
      'carrying',
      view.carried.map((thing) => thingWritten(thing, world)),
      'nothing',
    ),
    section(
      'what they could type',
      view.readings.flatMap((reading) => readingWritten(reading, world)),
      'nothing',
    ),
  ];
  if (fault !== null) {
    const against = fault.object === null ? '' : `, against ${pathOf(world, fault.object)}`;
    page.push(`the poll faulted${against}, ${fault.name}: ${fault.detail}\n`);
  }
  return { ok: fault === null, page: page.join('\n') };
}
