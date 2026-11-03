import { usaCities } from 'typed-usa-states/dist/cities';
import { usaStates } from 'typed-usa-states/dist/states';

export const US_STATES = usaStates;

const stateNamesByCode = new Map(
  usaStates.map((state) => [state.abbreviation, state.name] as const),
);
const citiesByState = new Map<string, Set<string>>();

for (const city of usaCities) {
  const stateCities = citiesByState.get(city.state) ?? new Set<string>();
  stateCities.add(city.name);
  citiesByState.set(city.state, stateCities);
}

export function usCitiesForState(stateCode: string): string[] {
  const stateName = stateNamesByCode.get(stateCode);
  if (!stateName) return [];
  return [...(citiesByState.get(stateName) ?? [])].sort((left, right) =>
    left.localeCompare(right),
  );
}

export function isUsCityForState(city: string, stateCode: string): boolean {
  const stateName = stateNamesByCode.get(stateCode);
  return stateName ? (citiesByState.get(stateName)?.has(city) ?? false) : false;
}
