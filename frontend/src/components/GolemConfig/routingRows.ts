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
 * [#490] A role's effective fallback chain, as go-llm v0.5.0's `RoleChain`
 * walks it (`config/resolve.go`): depth first, in declared order, through
 * each fallback's own fallbacks, keeping the first of each provider/model
 * selector. A role whose model is already in the chain adds nothing, though
 * its own fallbacks are still walked; the role itself is not in the result.
 * Each role is walked once: a second walk of a diamond's shared role reaches
 * only selectors the first already kept. Read-only: Shared configuration
 * shows it; nothing stages from it.
 */
export function roleChain(
  role: string,
  models: readonly ModelProjection[],
  /**
   * The model the role will run once a staged change applies: a fork or a
   * retarget keeps the role's fallbacks under a new primary model.
   */
  primary?: { provider: string; model: string }
): string[] {
  const byRole = new Map(models.map((model) => [model.role, model]));
  const selectors = new Set<string>();
  const walked = new Set<string>();
  const chain: string[] = [];
  const walk = (name: string) => {
    const model = byRole.get(name);
    if (model === undefined || walked.has(name)) return;
    walked.add(name);
    const own =
      name === role && primary !== undefined
        ? primary
        : { provider: model.provider, model: model.modelName };
    const selector = `${own.provider}\u0000${own.model}`;
    if (!selectors.has(selector)) {
      selectors.add(selector);
      if (name !== role) chain.push(name);
    }
    for (const next of model.fallbacks ?? []) walk(next);
  };
  walk(role);
  return chain;
}
