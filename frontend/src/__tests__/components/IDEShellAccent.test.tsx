import { render } from '@testing-library/react';
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
