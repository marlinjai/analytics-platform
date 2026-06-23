'use client';

import React from 'react';
import { useLumitraVariant } from './hooks.js';

interface VariantProps {
  experiment: string;
  variants: Record<string, React.ReactNode>;
  fallback?: React.ReactNode;
}

/**
 * Render different content based on the assigned variant.
 *
 * @example
 * ```tsx
 * <LumitraVariant
 *   experiment="hero-cta-test"
 *   variants={{
 *     control: <Button>Join Waitlist</Button>,
 *     'green-cta': <Button color="green">Start Free</Button>,
 *   }}
 *   fallback={<Button>Join Waitlist</Button>}
 * />
 * ```
 */
export function LumitraVariant({
  experiment,
  variants,
  fallback = null,
}: VariantProps) {
  const variant = useLumitraVariant(experiment);
  if (variant === null) return <>{fallback}</>;
  return <>{variants[variant] ?? fallback}</>;
}
