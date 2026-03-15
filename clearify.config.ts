import { defineConfig } from '@marlinjai/clearify';

export default defineConfig({
  name: 'Analytics Platform',
  docsDir: './docs',
  hubProject: {
    hubUrl: 'https://docs.lumitra.co',
    hubName: 'ERP Suite',
    description: 'Self-hosted analytics, heatmaps, and session replay',
    status: 'development',
    icon: '📈',
    tags: ['analytics', 'heatmap', 'replay'],
    group: 'Applications',
  },
  sections: [
    { label: 'Documentation', docsDir: './docs/public' },
    {
      label: 'Internal',
      docsDir: './docs/internal',
      basePath: '/internal',
      draft: true,
    },
  ],
  mermaid: {
    strategy: 'client',
  },
});
