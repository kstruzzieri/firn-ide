import { compareString, type RouteProjection, type SettingsDiagnostic } from '../../types/golem';
import { USE_CASE_FLOORS } from '../../types/golemConfig';

/**
 * Editor gate keys. NUL is a Cc rune, so no identifier reaching this surface
 * can collide with one — including the provider names sharing the same set.
 */
export const routeRowKey = (useCase: string): string => `\u0000route\u0000${useCase}`;

/** Firn's known use cases plus the ones this configuration authors. */
export function routeUseCases(routes: readonly RouteProjection[]): string[] {
  const names = new Set<string>([...USE_CASE_FLOORS.keys()]);
  for (const route of routes) names.add(route.useCase);
  return [...names].sort(compareString);
}

/**
 * True while this diagnostic belongs to a route row rather than the page. The
 * workspace calls this to decide what NOT to render above the cards, so both
 * answers come from one rule.
 */
export const routingOwnsDiagnostic = (
  routes: readonly RouteProjection[],
  diagnostic: SettingsDiagnostic
): boolean =>
  diagnostic.subjectKind === 'use_case' && routeUseCases(routes).includes(diagnostic.subjectName);
