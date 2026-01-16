/* @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { InteractionCard } from './InteractionCard';

describe('InteractionCard', () => {
  it('submits selected single option', async () => {
    const onSubmit = vi.fn();
    const interaction = {
      id: 'i-1',
      mode: 'single' as const,
      field: 'tts_voice' as const,
      title: '请选择音色',
      options: [
        { label: '音色 a', value: 'a' },
        { label: '音色 b', value: 'b' },
      ],
    };

    render(<InteractionCard interaction={interaction} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: '音色 a' }));
    fireEvent.click(screen.getByRole('button', { name: '确认' }));

    expect(onSubmit).toHaveBeenCalledWith({ selected: ['a'], file: null });
  });

  it('requires image file before submit', () => {
    const onSubmit = vi.fn();
    const interaction = {
      id: 'i-2',
      mode: 'image' as const,
      field: 'face_profiles' as const,
      title: '上传人脸图片',
      options: [
        { label: '老刘', value: '老刘' },
        { label: '老王', value: '老王' },
      ],
    };

    const { container } = render(<InteractionCard interaction={interaction} onSubmit={onSubmit} />);

    fireEvent.click(screen.getByRole('button', { name: '老刘' }));
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['demo'], 'face.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: '确认' }));

    expect(onSubmit).toHaveBeenCalledWith({ selected: ['老刘'], file });
  });
});
