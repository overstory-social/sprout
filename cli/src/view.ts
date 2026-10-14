import {
  type CommandExit,
  type Fault,
  type InstanceId,
  type SeenFiller,
  type SeenOptions,
  type SeenPlace,
  type SeenReading,
  type SeenThing,
} from '@overstory/sprout/lang';

import { pathOf, type Standing } from '@overstory/sprout-player';

// `sprout view`: what a visitor standing somewhere is shown and offered,
// as a poll gives it (the spec's The runtime › The view): the place's
// description rendered for them, the ways out that apply, who else is
// there, what they carry, and every reading they could make with its
// consent pass's answer, what fills each of its roles and the options of
// each value role. `--scene` polls the scene instead, which lists the verbs
// in place of the readings, and `--verb` one verb's readings. A poll that
// faults is shown as the visitor would see it, then the fault the host
// would log. Each poll is the engine's the visitor stands under.

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

/** What a view and a scene both show, from the description to what the visitor carries. */
function placeWritten(place: SeenPlace, world: InstanceId): string[] {
  return [
    section('description', place.description, '(it renders nothing)'),
    ...(place.effects.length === 0
      ? []
      : [
          section(
            'effects',
            place.effects.map(
              (effect) =>
                `${effect.extension}.${effect.statement} ${JSON.stringify(effect.payload)} reads ${effect.transcript}`,
            ),
            'none',
          ),
        ]),
    section(
      'ways out',
      place.exits.map((exit) => exitWritten(exit, world)),
      'none',
    ),
    section(
      'who else is here',
      place.occupants.map((thing) => thingWritten(thing, world)),
      'nobody',
    ),
    section(
      'carrying',
      place.carried.map((thing) => thingWritten(thing, world)),
      'nothing',
    ),
  ];
}

/** `sections` under where the visitor stands, then the fault where the poll faulted. */
function pageOf(
  standing: Standing,
  sections: readonly string[],
  fault: Fault | null,
): InspectedView {
  const world = standing.host.catalogue.world;
  const page = [`standing in ${pathOf(world, standing.place)}\n`, ...sections];
  if (fault !== null) {
    const against = fault.object === null ? '' : `, against ${pathOf(world, fault.object)}`;
    page.push(`the poll faulted${against}, ${fault.name}: ${fault.detail}\n`);
  }
  return { ok: fault === null, page: page.join('\n') };
}

/** The view of the visitor `standing` holds, polled from where they stand, as a page. */
export function inspectView(standing: Standing): InspectedView {
  const world = standing.host.catalogue.world;
  const { view, fault } = standing.engine.view(standing.stored, standing.visit);
  return pageOf(
    standing,
    [
      ...placeWritten(view, world),
      section(
        'what they could type',
        view.readings.flatMap((reading) => readingWritten(reading, world)),
        'nothing',
      ),
    ],
    fault,
  );
}

/** The scene of the visitor `standing` holds: the view's page with the verbs it lists in place of the readings. */
export function inspectScene(standing: Standing): InspectedView {
  const world = standing.host.catalogue.world;
  const { scene, fault } = standing.engine.scene(standing.stored, standing.visit);
  return pageOf(
    standing,
    [
      ...placeWritten(scene, world),
      section(
        'verbs they could be offered',
        scene.verbs.map((one) => one.verb),
        'none',
      ),
    ],
    fault,
  );
}

/** The readings of `verb`, by its qualified name, that the visitor `standing` holds could make, as a page. */
export function inspectReadings(standing: Standing, verb: string): InspectedView {
  const world = standing.host.catalogue.world;
  const { readings, fault } = standing.engine.readings(standing.stored, standing.visit, verb);
  return pageOf(
    standing,
    [
      section(
        `what they could type with ${verb}`,
        readings.flatMap((reading) => readingWritten(reading, world)),
        'nothing',
      ),
    ],
    fault,
  );
}
