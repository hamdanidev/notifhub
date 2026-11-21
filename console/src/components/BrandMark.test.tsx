import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrandMark } from './BrandMark';

describe('BrandMark', () => {
  it('renders the hub mark with the lane variant class', () => {
    const { container } = render(<BrandMark variant="platform" />);
    const svg = container.querySelector('svg.brand-mark--platform');

    expect(svg).not.toBeNull();
    expect(container.querySelectorAll('.brand-mark__node')).toHaveLength(3);
    expect(container.querySelectorAll('.brand-mark__spoke')).toHaveLength(1);
  });
});
