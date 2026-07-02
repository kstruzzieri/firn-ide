/**
 * Test: Jest Configuration Works
 *
 * These tests verify the testing infrastructure is properly configured.
 * TDD: Written first to define expected behavior.
 */

export {};

describe('Jest Configuration', () => {
  it('should run TypeScript tests', () => {
    const add = (a: number, b: number): number => a + b;
    expect(add(1, 2)).toBe(3);
  });

  it('should have access to jest-dom matchers', () => {
    // This will fail until jest-dom is properly configured
    const div = document.createElement('div');
    div.textContent = 'Hello';
    document.body.appendChild(div);
    expect(div).toBeInTheDocument();
    document.body.removeChild(div);
  });
});
