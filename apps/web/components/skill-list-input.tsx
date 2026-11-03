'use client';

import { useState } from 'react';

import { mergeSkills, normalizeSkill } from '../lib/skills';

function splitSkills(value: string): string[] {
  return value
    .split(',')
    .map((skill) => skill.trim())
    .filter(Boolean);
}

/**
 * Comma-separated skill field with one-click suggestions, so a service's
 * required skills and a technician's skills use the same spelling.
 */
export function SkillListInput({
  ariaDescribedBy,
  defaultSkills,
  maxLength,
  name,
  placeholder,
  suggestionLabel,
  suggestions,
}: Readonly<{
  ariaDescribedBy?: string;
  defaultSkills: readonly string[];
  maxLength?: number;
  name: string;
  placeholder?: string;
  suggestionLabel: string;
  suggestions: readonly string[];
}>) {
  const [value, setValue] = useState(defaultSkills.join(', '));
  const present = new Set(splitSkills(value).map(normalizeSkill));
  const available = mergeSkills([], suggestions)
    .filter((skill) => !present.has(normalizeSkill(skill)))
    .sort((left, right) => left.localeCompare(right));

  return (
    <>
      <input
        aria-describedby={ariaDescribedBy}
        maxLength={maxLength}
        name={name}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
      {available.length ? (
        <div className="skill-suggestions">
          <span>{suggestionLabel}</span>
          <ul className="skill-chips">
            {available.map((skill) => (
              <li key={skill}>
                <button
                  aria-label={`Add skill ${skill}`}
                  onClick={() =>
                    setValue(
                      mergeSkills(splitSkills(value), [skill]).join(', '),
                    )
                  }
                  type="button"
                >
                  + {skill}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </>
  );
}
