import { render, screen } from '@testing-library/react';
import {
  mergeTimelineSources,
  SourceTimelineView,
  type TimelineSource,
} from '../../../components/RunOutput/SourceTimelineView';
import type { OutputEntry } from '../../../types/runOutput';

jest.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 20,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        start: index * 20,
        size: 20,
        key: index,
      })),
    measureElement: () => {},
    scrollToIndex: () => {},
  }),
}));

jest.mock('../../../components/RunOutput/OutputLine', () => ({
  OutputLine: ({ text }: { text: string }) => <div data-testid="output-line">{text}</div>,
}));

// ---- mergeTimelineSources unit tests ----

describe('mergeTimelineSources', () => {
  it('returns an empty array when no sources provided', () => {
    expect(mergeTimelineSources([])).toEqual([]);
  });

  it('returns an empty array when all sources have no entries', () => {
    const sources: TimelineSource[] = [
      { id: 'a', label: 'Source A', entries: [] },
      { id: 'b', label: 'Source B', entries: [] },
    ];
    expect(mergeTimelineSources(sources)).toEqual([]);
  });

  it('merges entries from multiple sources and sorts ascending by timestamp', () => {
    const sources: TimelineSource[] = [
      {
        id: 'frontend',
        label: 'Frontend',
        workingDir: '/app/frontend',
        entries: [
          { stream: 'stdout', text: 'F1', timestamp: 300 },
          { stream: 'stdout', text: 'F2', timestamp: 100 },
        ],
      },
      {
        id: 'backend',
        label: 'Backend',
        workingDir: '/app/backend',
        entries: [
          { stream: 'stdout', text: 'B1', timestamp: 200 },
          { stream: 'stderr', text: 'B2', timestamp: 400 },
        ],
      },
    ];

    const result = mergeTimelineSources(sources);

    expect(result).toHaveLength(4);
    expect(result.map((e) => e.timestamp)).toEqual([100, 200, 300, 400]);
    expect(result.map((e) => e.text)).toEqual(['F2', 'B1', 'F1', 'B2']);
  });

  it('carries correct sourceLabel and workingDir for each merged entry', () => {
    const sources: TimelineSource[] = [
      {
        id: 'svc-a',
        label: 'Service A',
        workingDir: '/path/a',
        entries: [{ stream: 'stdout', text: 'hello', timestamp: 1 }],
      },
      {
        id: 'svc-b',
        label: 'Service B',
        workingDir: '/path/b',
        entries: [{ stream: 'stderr', text: 'error', timestamp: 2 }],
      },
    ];

    const result = mergeTimelineSources(sources);

    expect(result[0]).toMatchObject({
      text: 'hello',
      sourceId: 'svc-a',
      sourceLabel: 'Service A',
      workingDir: '/path/a',
    });
    expect(result[1]).toMatchObject({
      text: 'error',
      sourceId: 'svc-b',
      sourceLabel: 'Service B',
      workingDir: '/path/b',
    });
  });

  it('preserves source-then-entry order for entries with equal timestamps (stable sort)', () => {
    const ts = 1000;
    const sources: TimelineSource[] = [
      {
        id: 'first',
        label: 'First',
        entries: [
          { stream: 'stdout', text: 'first-A', timestamp: ts },
          { stream: 'stdout', text: 'first-B', timestamp: ts },
        ],
      },
      {
        id: 'second',
        label: 'Second',
        entries: [
          { stream: 'stdout', text: 'second-A', timestamp: ts },
          { stream: 'stdout', text: 'second-B', timestamp: ts },
        ],
      },
    ];

    const result = mergeTimelineSources(sources);

    expect(result.map((e) => e.text)).toEqual(['first-A', 'first-B', 'second-A', 'second-B']);
  });

  it('handles a source with undefined workingDir', () => {
    const sources: TimelineSource[] = [
      {
        id: 'lint',
        label: 'Lint',
        entries: [{ stream: 'stdout', text: 'ok', timestamp: 1 }],
      },
    ];

    const result = mergeTimelineSources(sources);

    expect(result[0].workingDir).toBeUndefined();
    expect(result[0].sourceLabel).toBe('Lint');
  });

  it('preserves original OutputEntry fields (stream, text, timestamp)', () => {
    const entry: OutputEntry = { stream: 'stderr', text: 'warn message', timestamp: 9999 };
    const sources: TimelineSource[] = [{ id: 'x', label: 'X', entries: [entry] }];

    const result = mergeTimelineSources(sources);

    expect(result[0].stream).toBe('stderr');
    expect(result[0].text).toBe('warn message');
    expect(result[0].timestamp).toBe(9999);
  });
});

// ---- SourceTimelineView render tests ----

describe('SourceTimelineView', () => {
  it('renders empty message when no sources have entries', () => {
    render(
      <SourceTimelineView
        sources={[{ id: 'a', label: 'A', entries: [] }]}
        autoScroll={false}
        emptyMessage="Nothing here yet"
      />
    );

    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
  });

  it('uses default empty message when emptyMessage prop is not provided', () => {
    render(<SourceTimelineView sources={[]} autoScroll={false} />);

    expect(screen.getByText('No output')).toBeInTheDocument();
  });

  it('renders source LABELS in the DOM (not raw ids)', () => {
    const sources: TimelineSource[] = [
      {
        id: 'svc-frontend',
        label: 'Frontend Dev Server',
        entries: [{ stream: 'stdout', text: 'compiled ok', timestamp: 1 }],
      },
      {
        id: 'svc-backend',
        label: 'Backend API',
        entries: [{ stream: 'stdout', text: 'listening on 3000', timestamp: 2 }],
      },
    ];

    render(<SourceTimelineView sources={sources} autoScroll={false} />);

    expect(screen.getByText('Frontend Dev Server')).toBeInTheDocument();
    expect(screen.getByText('Backend API')).toBeInTheDocument();

    // Raw ids must NOT appear as label spans
    expect(screen.queryByText('svc-frontend')).not.toBeInTheDocument();
    expect(screen.queryByText('svc-backend')).not.toBeInTheDocument();
  });

  it('renders all entry texts via OutputLine', () => {
    const sources: TimelineSource[] = [
      {
        id: 'a',
        label: 'A',
        entries: [
          { stream: 'stdout', text: 'line one', timestamp: 10 },
          { stream: 'stderr', text: 'line two', timestamp: 20 },
        ],
      },
    ];

    render(<SourceTimelineView sources={sources} autoScroll={false} />);

    expect(screen.getByText('line one')).toBeInTheDocument();
    expect(screen.getByText('line two')).toBeInTheDocument();
  });
});
