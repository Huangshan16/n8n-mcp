import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BuildProgressBar } from './BuildProgressBar';

describe('BuildProgressBar', () => {
  it('renders steps and progress hint', () => {
    render(<BuildProgressBar status={2} />);

    expect(screen.getByText('生成JSON')).toBeInTheDocument();
    expect(screen.getByText('校验工作流')).toBeInTheDocument();
    expect(screen.getByText('部署到n8n')).toBeInTheDocument();
    expect(screen.getByText('正在构建，请稍候…')).toBeInTheDocument();
  });

  it('hides progress hint when complete', () => {
    render(<BuildProgressBar status={3} />);

    expect(screen.queryByText('正在构建，请稍候…')).toBeNull();
  });
});
