import { initials } from '../lib/util.js';

export default function Avatar({ name, color, size = 'md', style }) {
  const cls = size === 'lg' ? 'avatar avatar-lg' : size === 'xs' ? 'avatar avatar-xs' : 'avatar';
  return (
    <span className={cls} style={{ background: color || '#666', ...style }} title={name}>
      {initials(name)}
    </span>
  );
}
