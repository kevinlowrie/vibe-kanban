import { describe, expect, it } from 'vitest';
import {
  applyScheduleProposal,
  proposeReschedule,
  validateScheduleState,
  ScheduleError,
  type ScheduleState,
} from './contract';
const state = (): ScheduleState => ({
  revision: 1,
  items: [
    {
      id: 'a',
      projectId: 'p',
      title: 'A',
      startDate: '2024-02-28',
      endDate: '2024-02-29',
      dependsOn: [],
    },
    {
      id: 'b',
      projectId: 'p',
      title: 'B',
      startDate: '2024-03-01',
      endDate: '2024-03-03',
      dependsOn: ['a'],
    },
    {
      id: 'c',
      projectId: 'p',
      title: 'C',
      startDate: '2024-03-10',
      endDate: '2024-03-10',
      dependsOn: ['b'],
    },
  ],
});
const request = {
  itemId: 'a',
  startDate: '2024-03-02',
  endDate: '2024-03-04',
  shiftDependents: true,
};
const code = (fn: () => unknown, value: string) => {
  try {
    fn();
    throw Error('Expected rejection');
  } catch (e) {
    expect(e).toBeInstanceOf(ScheduleError);
    expect((e as ScheduleError).code).toBe(value);
  }
};
describe('scheduling contract', () => {
  it('cascades only necessary successors with inclusive durations', () => {
    const s = state(),
      p = proposeReschedule(s, request, 1);
    expect(p.changes.map((x) => [x.id, x.after])).toEqual([
      ['a', { startDate: '2024-03-02', endDate: '2024-03-04' }],
      ['b', { startDate: '2024-03-05', endDate: '2024-03-07' }],
    ]);
    const out = applyScheduleProposal(s, p);
    expect(out.revision).toBe(2);
    expect(out.items[2]).toEqual(s.items[2]);
  });
  it('rejects cascade disabled and predecessor violations', () => {
    code(
      () =>
        proposeReschedule(state(), { ...request, shiftDependents: false }, 1),
      'DEPENDENCY_VIOLATION'
    );
    code(
      () =>
        proposeReschedule(
          state(),
          {
            ...request,
            itemId: 'b',
            startDate: '2024-02-28',
            endDate: '2024-02-28',
          },
          1
        ),
      'DEPENDENCY_VIOLATION'
    );
  });
  it.each([
    '2023-02-29',
    '2024-02-30',
    '2024-2-01',
    '2024-01-01T00:00:00Z',
    '0000-01-01',
  ])('rejects invalid date %s', (startDate) => {
    code(
      () => proposeReschedule(state(), { ...request, startDate }, 1),
      'INVALID_DATE'
    );
  });
  it('rejects reversed dates', () =>
    code(
      () =>
        proposeReschedule(state(), { ...request, startDate: '2024-04-01' }, 1),
      'INVALID_DURATION'
    ));
  it('rejects stale revision both proposal and apply', () => {
    code(() => proposeReschedule(state(), request, 0), 'STALE_REVISION');
    code(
      () =>
        applyScheduleProposal(
          { ...state(), revision: 2 },
          proposeReschedule(state(), request, 1)
        ),
      'STALE_REVISION'
    );
  });
  it('rejects forged before, unknown ID, duplicate changes and bad result dependency', () => {
    const p = proposeReschedule(state(), request, 1);
    code(
      () =>
        applyScheduleProposal(state(), {
          ...p,
          changes: [
            {
              ...p.changes[0],
              before: { startDate: '2020-01-01', endDate: '2020-01-01' },
            },
          ],
        }),
      'INVALID_PROPOSAL'
    );
    code(
      () =>
        applyScheduleProposal(state(), {
          ...p,
          changes: [{ ...p.changes[0], id: 'unknown' }],
        }),
      'INVALID_PROPOSAL'
    );
    code(
      () =>
        applyScheduleProposal(state(), {
          ...p,
          changes: [p.changes[0], p.changes[0]],
        }),
      'INVALID_PROPOSAL'
    );
    code(
      () => applyScheduleProposal(state(), { ...p, changes: [p.changes[0]] }),
      'DEPENDENCY_VIOLATION'
    );
  });
  it('rejects duplicate IDs, missing dependencies, cross-project edges and cycles', () => {
    let s = state();
    s.items[1].id = 'a';
    code(() => validateScheduleState(s), 'DUPLICATE_ID');
    s = state();
    s.items[1].dependsOn = ['missing'];
    code(() => validateScheduleState(s), 'MISSING_DEPENDENCY');
    s = state();
    s.items[1].projectId = 'q';
    code(() => validateScheduleState(s), 'CROSS_PROJECT_DEPENDENCY');
    s = state();
    s.items[0].dependsOn = ['c'];
    code(() => validateScheduleState(s), 'CYCLE');
  });
  it('never mutates state or proposal and returns independent arrays', () => {
    const s = state(),
      before = JSON.stringify(s),
      p = proposeReschedule(s, request, 1),
      original = JSON.stringify(p);
    const out = applyScheduleProposal(s, p);
    out.items[0].dependsOn.push('x');
    out.items[0].title = 'changed';
    expect(JSON.stringify(s)).toBe(before);
    expect(JSON.stringify(p)).toBe(original);
  });
  it('uses date-only arithmetic across DST and leap days', () => {
    const s: ScheduleState = {
      revision: 0,
      items: [
        { ...state().items[0], startDate: '2024-03-09', endDate: '2024-03-10' },
        { ...state().items[1], startDate: '2024-03-11', endDate: '2024-03-12' },
      ],
    };
    const p = proposeReschedule(
      s,
      { ...request, startDate: '2024-03-10', endDate: '2024-03-11' },
      0
    );
    expect(p.changes[1].after).toEqual({
      startDate: '2024-03-12',
      endDate: '2024-03-13',
    });
  });
  it('topological cascade handles reverse item order and multiple predecessors', () => {
    const s = state();
    s.items[2].dependsOn = ['a', 'b'];
    s.items.reverse();
    const p = proposeReschedule(s, { ...request, endDate: '2024-03-12' }, 1);
    const out = applyScheduleProposal(s, p);
    expect(out.items.find((x) => x.id === 'c')?.startDate).toBe('2024-03-16');
  });
  it('bounds input and rejects unknown items', () => {
    const s = state();
    s.items[0].title = 'x'.repeat(501);
    code(() => validateScheduleState(s), 'INVALID_STATE');
    code(
      () =>
        validateScheduleState({
          ...state(),
          items: Array(1001).fill(state().items[0]),
        }),
      'INVALID_STATE'
    );
    code(
      () => proposeReschedule(state(), { ...request, itemId: 'absent' }, 1),
      'ITEM_NOT_FOUND'
    );
  });
  it('rejects overflow past year9999 during cascade', () => {
    const s = state();
    s.items = [
      { ...s.items[0], startDate: '9999-12-29', endDate: '9999-12-29' },
      { ...s.items[1], startDate: '9999-12-30', endDate: '9999-12-31' },
    ];
    code(
      () =>
        proposeReschedule(
          s,
          { ...request, startDate: '9999-12-31', endDate: '9999-12-31' },
          1
        ),
      'INVALID_DATE'
    );
  });
});
