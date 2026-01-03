import { HardwareService } from './hardware-service';
import { Intent, Scenario, ScenarioParameter } from './types';

export interface ScenarioRepositoryLike {
  findByIntent(category: string, subCategory?: string): Promise<Scenario[]>;
}

export class ScenarioMatcher {
  constructor(
    private scenarioRepository: ScenarioRepositoryLike,
    private hardwareService: HardwareService
  ) {}

  async match(intent: Intent): Promise<Scenario[]> {
    const candidates = await this.scenarioRepository.findByIntent(intent.category, intent.subCategory);
    if (candidates.length === 0) {
      return [];
    }

    const inferredComponents = this.hardwareService.inferComponentsFromIntent(intent);

    return candidates
      .map((scenario) => {
        const hydrated = this.applyIntentToScenario(scenario, intent);
        const score = this.calculateSimilarity(hydrated, intent, inferredComponents);
        return { scenario: hydrated, score };
      })
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.scenario);
  }

  private calculateSimilarity(scenario: Scenario, intent: Intent, inferredComponents: string[]): number {
    const paramMatches = scenario.requiredParams.filter((param) =>
      intent.entities.some((entity) => entity.type === param.type)
    ).length;
    const paramScore = scenario.requiredParams.length === 0 ? 0 : paramMatches / scenario.requiredParams.length;

    const componentMatches = scenario.requiredComponents.filter((component) =>
      inferredComponents.includes(component)
    ).length;
    const componentScore =
      scenario.requiredComponents.length === 0
        ? 0
        : componentMatches / scenario.requiredComponents.length;

    return paramScore * 0.4 + componentScore * 0.6;
  }

  private applyIntentToScenario(scenario: Scenario, intent: Intent): Scenario {
    const params = scenario.requiredParams.map((param) => ({ ...param }));
    const remainingEntities = [...intent.entities];

    const updatedParams = params.map((param) => this.fillParam(param, remainingEntities));

    return {
      ...scenario,
      requiredParams: updatedParams,
    };
  }

  private fillParam(param: ScenarioParameter, entities: Intent['entities']): ScenarioParameter {
    if (param.value !== undefined && param.value !== null) {
      return param;
    }

    const defaultValue = param.default ?? null;
    const entityIndex = entities.findIndex((entity) => entity.type === param.type);

    if (entityIndex >= 0) {
      const matched = entities.splice(entityIndex, 1)[0];
      return { ...param, value: matched.value };
    }

    if (defaultValue !== null && defaultValue !== undefined) {
      return { ...param, value: defaultValue };
    }

    return param;
  }
}
