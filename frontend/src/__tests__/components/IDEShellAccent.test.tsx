import { render, screen } from '@testing-library/react';
import { IDEShell } from '../../components/layout';

jest.mock('../../../wailsjs/go/main/App', () => ({
  ToggleMaximize: jest.fn(),
}));

it('applies data-accent="general"', () => {
  const { container } = render(
    <IDEShell
      accent="general"
      header={<div />}
      sidebar={<div />}
      leftPanel={<div />}
      centerPanel={<div />}
      bottomPanel={<div />}
      rightPanel={<div />}
      statusBar={<div />}
    />
  );
  expect(container.querySelector('[data-accent="general"]')).not.toBeNull();
});

it('renders a skip link before the shell chrome and a focusable main target', () => {
  const { container } = render(
    <IDEShell
      header={<div />}
      sidebar={<div />}
      leftPanel={<div />}
      centerPanel={<div />}
      bottomPanel={<div />}
      rightPanel={<div />}
      statusBar={<div />}
    />
  );

  const skipLink = screen.getByRole('link', { name: 'Skip to main content' });
  const main = screen.getByRole('main');

  expect(skipLink).toHaveAttribute('href', '#main-content');
  expect(container.firstElementChild?.firstElementChild).toBe(skipLink);
  expect(main).toHaveAttribute('id', 'main-content');
  expect(main).toHaveAttribute('tabindex', '-1');
});
