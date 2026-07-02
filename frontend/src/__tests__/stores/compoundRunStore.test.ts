import { useIDEStore } from '../../stores/ideStore';
import type { CompoundRunEvent, OutputChunk } from '../../types/runOutput';

const COMPOUND_ID = 'ci';
const AGG_RID = 'r2';
const STEP0_RID = 'r3';

function makeEvent(overrides: Partial<CompoundRunEvent> = {}): CompoundRunEvent {
  return {
    runInstanceId: AGG_RID,
    compoundId: COMPOUND_ID,
    name: 'CI',
    state: 'running',
    currentStep: 0,
    steps: [
      {
        idx: 0,
        runInstanceId: STEP0_RID,
        profileId: 'build',
        name: 'Build',
        state: 'running',
        exitCode: 0,
        workingDir: 'frontend',
        durationMs: 0,
        startedAt: 1000,
      },
    ],
    ...overrides,
  };
}

function makeChunk(data: string, overrides: Partial<OutputChunk> = {}): OutputChunk {
  return {
    runInstanceId: STEP0_RID,
    profileId: 'build',
    parentRunInstanceId: AGG_RID,
    stepIdx: 0,
    stream: 'stdout',
    data,
    timestamp: 5000,
    ...overrides,
  };
}

beforeEach(() => {
  useIDEStore.setState({
    runCompounds: {},
    runOutputs: {},
    runHistory: {},
    stoppingProfileIds: [],
    restartingProfileIds: [],
    runStartTimestamps: {},
    stopRequestTimestamps: {},
    activeRunOutputId: null,
  });
  // Drop any leftover assemblers from prior tests by reusing the reset action,
  // then re-clear runCompounds (resetWorkspaceRunState clears assemblers globally).
  useIDEStore.getState().resetWorkspaceRunState();
});

describe('compoundRunStore - handleCompoundRun', () => {
  it('creates a CompoundRun with step metadata', () => {
    useIDEStore.getState().handleCompoundRun(makeEvent());
    const run = useIDEStore.getState().runCompounds[COMPOUND_ID];
    expect(run).toBeDefined();
    expect(run.name).toBe('CI');
    expect(run.state).toBe('running');
    expect(run.currentStep).toBe(0);
    expect(run.steps).toHaveLength(1);
    expect(run.steps[0].profileId).toBe('build');
    expect(run.steps[0].state).toBe('running');
    expect(run.stepOutputs).toEqual({});
  });

  it('replaces name/state/currentStep/steps but preserves existing stepOutputs', () => {
    useIDEStore.getState().handleCompoundRun(makeEvent());
    // Route some output into step 0.
    useIDEStore.getState().appendRunOutput(makeChunk('hello\n'));
    const outputsBefore = useIDEStore.getState().runCompounds[COMPOUND_ID].stepOutputs[0];
    expect(outputsBefore).toHaveLength(1);

    // Deliver an updated event (e.g. name change / step advanced).
    useIDEStore.getState().handleCompoundRun(
      makeEvent({
        name: 'CI v2',
        currentStep: 1,
        steps: [
          {
            idx: 0,
            runInstanceId: STEP0_RID,
            profileId: 'build',
            name: 'Build',
            state: 'running',
            exitCode: 0,
            workingDir: 'frontend',
            durationMs: 0,
            startedAt: 1000,
          },
        ],
      })
    );

    const run = useIDEStore.getState().runCompounds[COMPOUND_ID];
    expect(run.name).toBe('CI v2');
    expect(run.currentStep).toBe(1);
    expect(run.stepOutputs[0]).toHaveLength(1);
    expect(run.stepOutputs[0][0].text).toBe('hello');
  });
});

describe('compoundRunStore - appendRunOutput routing for composite keys', () => {
  it('routes assembled line into runCompounds stepOutputs without creating runOutputs', () => {
    useIDEStore.getState().handleCompoundRun(makeEvent());
    useIDEStore.getState().appendRunOutput(makeChunk('hello\n'));

    const run = useIDEStore.getState().runCompounds[COMPOUND_ID];
    expect(run.stepOutputs[0]).toBeDefined();
    expect(run.stepOutputs[0]).toHaveLength(1);
    expect(run.stepOutputs[0][0].text).toBe('hello');
    expect(run.stepOutputs[0][0].stream).toBe('stdout');

    // No ordinary RunOutput tab for the step's profile — it routed to the compound.
    expect(useIDEStore.getState().runOutputs['build']).toBeUndefined();
  });

  it('drops orphan composite output when no compound exists', () => {
    useIDEStore.getState().appendRunOutput(makeChunk('orphan\n'));
    expect(useIDEStore.getState().runCompounds[COMPOUND_ID]).toBeUndefined();
    expect(useIDEStore.getState().runOutputs['build']).toBeUndefined();
  });
});

describe('compoundRunStore - terminal step flush', () => {
  it('flushes unterminated content when a step becomes terminal', () => {
    useIDEStore.getState().handleCompoundRun(makeEvent());
    // Chunk WITHOUT a trailing newline — stays in the assembler carry-over.
    useIDEStore.getState().appendRunOutput(makeChunk('partial line'));
    // Not yet emitted as a complete line.
    expect(useIDEStore.getState().runCompounds[COMPOUND_ID].stepOutputs[0]).toBeUndefined();

    // Step transitions to success -> flush.
    useIDEStore.getState().handleCompoundRun(
      makeEvent({
        state: 'success',
        steps: [
          {
            idx: 0,
            runInstanceId: STEP0_RID,
            profileId: 'build',
            name: 'Build',
            state: 'success',
            exitCode: 0,
            workingDir: 'frontend',
            durationMs: 50,
            startedAt: 1000,
            endedAt: 1050,
          },
        ],
      })
    );

    const run = useIDEStore.getState().runCompounds[COMPOUND_ID];
    expect(run.stepOutputs[0]).toHaveLength(1);
    expect(run.stepOutputs[0][0].text).toBe('partial line');
  });
});

describe('compoundRunStore - run history on terminal step', () => {
  it('appends a RunHistoryEntry for a step with startedAt and endedAt', () => {
    useIDEStore.getState().handleCompoundRun(makeEvent());
    useIDEStore.getState().handleCompoundRun(
      makeEvent({
        state: 'success',
        steps: [
          {
            idx: 0,
            runInstanceId: STEP0_RID,
            profileId: 'build',
            name: 'Build',
            state: 'success',
            exitCode: 0,
            workingDir: 'frontend',
            durationMs: 50,
            startedAt: 1000,
            endedAt: 1050,
          },
        ],
      })
    );

    const history = useIDEStore.getState().runHistory['build'];
    expect(history).toHaveLength(1);
    expect(history[0].state).toBe('success');
    expect(history[0].duration).toBe(50);
    expect(history[0].timestamp).toBe(1050);
  });

  it('does not re-append history when the same terminal snapshot is delivered twice', () => {
    useIDEStore.getState().handleCompoundRun(makeEvent());
    const terminalEvent = makeEvent({
      state: 'success',
      steps: [
        {
          idx: 0,
          runInstanceId: STEP0_RID,
          profileId: 'build',
          name: 'Build',
          state: 'success',
          exitCode: 0,
          workingDir: 'frontend',
          durationMs: 50,
          startedAt: 1000,
          endedAt: 1050,
        },
      ],
    });
    useIDEStore.getState().handleCompoundRun(terminalEvent);
    useIDEStore.getState().handleCompoundRun(terminalEvent);
    expect(useIDEStore.getState().runHistory['build']).toHaveLength(1);
  });
});

describe('compoundRunStore - clearRunOutput / clearCompoundRunOutput', () => {
  it('clearRunOutput on a compound id clears its stepOutputs', () => {
    useIDEStore.getState().handleCompoundRun(makeEvent());
    useIDEStore.getState().appendRunOutput(makeChunk('hello\n'));
    expect(useIDEStore.getState().runCompounds[COMPOUND_ID].stepOutputs[0]).toHaveLength(1);

    useIDEStore.getState().clearRunOutput(COMPOUND_ID);
    const run = useIDEStore.getState().runCompounds[COMPOUND_ID];
    expect(run).toBeDefined();
    expect(run.stepOutputs).toEqual({});

    // Assembler was reset: new output after clear starts fresh.
    useIDEStore.getState().appendRunOutput(makeChunk('again\n'));
    expect(useIDEStore.getState().runCompounds[COMPOUND_ID].stepOutputs[0]).toHaveLength(1);
    expect(useIDEStore.getState().runCompounds[COMPOUND_ID].stepOutputs[0][0].text).toBe('again');
  });

  it('clearCompoundRunOutput clears stepOutputs while keeping the run record', () => {
    useIDEStore.getState().handleCompoundRun(makeEvent());
    useIDEStore.getState().appendRunOutput(makeChunk('hello\n'));
    useIDEStore.getState().clearCompoundRunOutput(COMPOUND_ID);
    const run = useIDEStore.getState().runCompounds[COMPOUND_ID];
    expect(run).toBeDefined();
    expect(run.steps).toHaveLength(1);
    expect(run.stepOutputs).toEqual({});
  });
});

describe('compoundRunStore - resetWorkspaceRunState', () => {
  it('clears runCompounds to {}', () => {
    useIDEStore.getState().handleCompoundRun(makeEvent());
    expect(useIDEStore.getState().runCompounds[COMPOUND_ID]).toBeDefined();
    useIDEStore.getState().resetWorkspaceRunState();
    expect(useIDEStore.getState().runCompounds).toEqual({});
  });
});

describe('compoundRunStore - rerun resets step output', () => {
  it('starts step outputs fresh when a terminal compound runs again', () => {
    // First run: produce output, then go terminal.
    useIDEStore.getState().handleCompoundRun(makeEvent());
    useIDEStore.getState().appendRunOutput(makeChunk('first run\n'));
    expect(useIDEStore.getState().runCompounds[COMPOUND_ID].stepOutputs[0]).toHaveLength(1);
    useIDEStore.getState().handleCompoundRun(
      makeEvent({
        state: 'success',
        steps: [
          {
            idx: 0,
            runInstanceId: STEP0_RID,
            profileId: 'build',
            name: 'Build',
            state: 'success',
            exitCode: 0,
            workingDir: 'frontend',
            durationMs: 1000,
            startedAt: 1000,
            endedAt: 2000,
          },
        ],
      })
    );

    // Second run of the same compound: a terminal→running snapshot must drop the
    // previous run's output rather than carrying it over.
    useIDEStore.getState().handleCompoundRun(makeEvent());
    expect(useIDEStore.getState().runCompounds[COMPOUND_ID].stepOutputs[0] ?? []).toHaveLength(0);

    useIDEStore.getState().appendRunOutput(makeChunk('second run\n'));
    const outputs = useIDEStore.getState().runCompounds[COMPOUND_ID].stepOutputs[0];
    expect(outputs).toHaveLength(1);
    expect(outputs[0].text).toBe('second run');
  });
});

describe('compoundRunStore - clearAllRunOutputs', () => {
  it('preserves a still-running compound so later output is not orphaned', () => {
    useIDEStore.getState().handleCompoundRun(makeEvent());
    useIDEStore.getState().appendRunOutput(makeChunk('before clear\n'));

    useIDEStore.getState().clearAllRunOutputs();

    const run = useIDEStore.getState().runCompounds[COMPOUND_ID];
    expect(run).toBeDefined();
    expect(run.state).toBe('running');
    expect(run.stepOutputs).toEqual({});

    // Composite output produced after the clear must still route into the
    // preserved compound (not be dropped as orphan).
    useIDEStore.getState().appendRunOutput(makeChunk('after clear\n'));
    const outputs = useIDEStore.getState().runCompounds[COMPOUND_ID].stepOutputs[0];
    expect(outputs).toHaveLength(1);
    expect(outputs[0].text).toBe('after clear');
  });
});

describe('compoundRunStore - identity routing & stale-event guards', () => {
  it('routes step 0 output by parentRunInstanceId + stepIdx', () => {
    const s = useIDEStore.getState();
    s.handleCompoundRun(makeEvent());
    s.appendRunOutput(makeChunk('line\n', { stepIdx: 0 }));
    expect(useIDEStore.getState().runCompounds[COMPOUND_ID].stepOutputs[0]?.[0]?.text).toBe('line');
  });

  it('drops a stale run:output chunk while the buffer is running', () => {
    const s = useIDEStore.getState();
    // Establish a running single-profile buffer at r5.
    s.handleRunStatus({
      runInstanceId: 'r5',
      profileId: 'build',
      stepIdx: 0,
      state: 'running',
      exitCode: 0,
      timestamp: 1,
    });
    s.appendRunOutput({
      runInstanceId: 'r5',
      profileId: 'build',
      stepIdx: 0,
      stream: 'stdout',
      data: 'fresh\n',
      timestamp: 2,
    });
    // A late chunk from an OLD instance r4 must be dropped.
    s.appendRunOutput({
      runInstanceId: 'r4',
      profileId: 'build',
      stepIdx: 0,
      stream: 'stdout',
      data: 'stale\n',
      timestamp: 3,
    });
    const entries = useIDEStore.getState().runOutputs['build'].entries.map((e) => e.text);
    expect(entries).toEqual(['fresh']);
  });

  it('rotates the buffer when rerun output arrives before its running status', () => {
    const s = useIDEStore.getState();
    // First run completes.
    s.handleRunStatus({
      runInstanceId: 'r5',
      profileId: 'build',
      stepIdx: 0,
      state: 'running',
      exitCode: 0,
      timestamp: 1,
    });
    s.appendRunOutput({
      runInstanceId: 'r5',
      profileId: 'build',
      stepIdx: 0,
      stream: 'stdout',
      data: 'old\n',
      timestamp: 2,
    });
    s.handleRunStatus({
      runInstanceId: 'r5',
      profileId: 'build',
      stepIdx: 0,
      state: 'success',
      exitCode: 0,
      timestamp: 3,
    });
    // Rerun output (r6) arrives BEFORE its running status → must rotate, not drop.
    s.appendRunOutput({
      runInstanceId: 'r6',
      profileId: 'build',
      stepIdx: 0,
      stream: 'stdout',
      data: 'new\n',
      timestamp: 4,
    });
    const out = useIDEStore.getState().runOutputs['build'];
    expect(out.runInstanceId).toBe('r6');
    expect(out.entries.map((e) => e.text)).toEqual(['new']);
    expect(out.previousEntries.map((e) => e.text)).toEqual(['old']);
  });

  it('drops a stale run:status that would flush the active run', () => {
    const s = useIDEStore.getState();
    s.handleRunStatus({
      runInstanceId: 'r7',
      profileId: 'build',
      stepIdx: 0,
      state: 'running',
      exitCode: 0,
      timestamp: 1,
    });
    s.appendRunOutput({
      runInstanceId: 'r7',
      profileId: 'build',
      stepIdx: 0,
      stream: 'stdout',
      data: 'partial',
      timestamp: 2,
    });
    // A late terminal status from old instance r6 must not flush/alter the r7 run.
    s.handleRunStatus({
      runInstanceId: 'r6',
      profileId: 'build',
      stepIdx: 0,
      state: 'success',
      exitCode: 0,
      timestamp: 3,
    });
    expect(useIDEStore.getState().runOutputs['build'].state).toBe('running');
  });

  it('does not let a stale running compound snapshot replace a rerun', () => {
    const s = useIDEStore.getState();
    s.handleCompoundRun(makeEvent({ runInstanceId: 'r10', state: 'running' }));
    // First run completes, then a newer rerun starts running.
    s.handleCompoundRun(makeEvent({ runInstanceId: 'r10', state: 'success' }));
    s.handleCompoundRun(makeEvent({ runInstanceId: 'r12', state: 'running' }));
    // A late old 'running' snapshot (r10) must be dropped.
    s.handleCompoundRun(makeEvent({ runInstanceId: 'r10', state: 'running' }));
    expect(useIDEStore.getState().runCompounds[COMPOUND_ID].runInstanceId).toBe('r12');
  });
});
