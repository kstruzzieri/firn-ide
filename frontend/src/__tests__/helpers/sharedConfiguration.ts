import { fireEvent, screen } from '@testing-library/react';

/**
 * #490 folds the routing table into Shared configuration, closed by default.
 * Tests that drive route rows open it first, the way a user would. A plain
 * click event, so a test running on fake timers is not held up.
 */
export async function openSharedConfiguration(): Promise<void> {
  const toggle = await screen.findByRole('button', { name: /^Shared configuration/ });
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
}
