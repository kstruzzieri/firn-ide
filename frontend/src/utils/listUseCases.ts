/**
 * Plain English for a list of use cases: "chat", "chat and completion",
 * "agent, chat and completion". One grammar for the route editor's notices,
 * the routing rows' reach sentences and the Apply bar's group headers, so a
 * careful reader never meets machine output in one place and prose in another.
 */
export const listUseCases = (useCases: readonly string[]): string =>
  useCases.length <= 1
    ? (useCases[0] ?? '')
    : `${useCases.slice(0, -1).join(', ')} and ${useCases[useCases.length - 1]}`;
