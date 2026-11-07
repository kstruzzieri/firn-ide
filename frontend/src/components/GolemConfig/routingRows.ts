import {
  compareString,
  type ModelProjection,
  type RouteProjection,
  type SettingsDiagnostic,
} from '../../types/golem';
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

/**
 * [#490] A role's effective fallback chain, as go-llm's `RoleChain` walks it:
 * depth first, in declared order, through each fallback's own fallbacks, each
 * role named once at its first place (a diamond is reached twice, named
 * once). The role itself is not in it. Read-only: Shared configuration shows
 * it; nothing stages from it.
 */
export function roleChain(role: string, models: readonly ModelProjection[]): string[] {
  const fallbacksOf = new Map(models.map((model) => [model.role, model.fallbacks ?? []]));
  const seen = new Set<string>([role]);
  const chain: string[] = [];
  const walk = (from: string) => {
    for (const next of fallbacksOf.get(from) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      chain.push(next);
      walk(next);
    }
  };
  walk(role);
  return chain;
}
