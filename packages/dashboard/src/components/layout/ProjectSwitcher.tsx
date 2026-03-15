'use client';

import { useEffect, useState } from 'react';
import type { Project } from '@analytics-platform/shared';

interface Props {
  currentProjectId: string | null;
  onSelect: (projectId: string) => void;
}

export function ProjectSwitcher({ currentProjectId, onSelect }: Props) {
  const [projects, setProjects] = useState<Project[]>([]);

  useEffect(() => {
    fetch('/api/projects')
      .then((r) => r.json())
      .then((data) => {
        setProjects(data.projects ?? []);
        if (!currentProjectId && data.projects?.length > 0) {
          onSelect(data.projects[0].id);
        }
      })
      .catch(() => {});
  }, [currentProjectId, onSelect]);

  return (
    <select
      value={currentProjectId ?? ''}
      onChange={(e) => onSelect(e.target.value)}
      className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 focus:border-blue-500 focus:outline-none"
    >
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
}
