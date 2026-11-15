/** The covers the app brings along. A page stores one as `gallery:<id>`. */
export const GALLERY_PREFIX = 'gallery:';

type Cover = { id: string; background: string };

export const COLOURS: Cover[] = [
  { id: 'coral', background: '#ec5b5b' },
  { id: 'amber', background: '#f7c154' },
  { id: 'azure', background: '#1b9dd2' },
  { id: 'cream', background: '#fdeee2' },
];

export const GRADIENTS: Cover[] = [
  { id: 'lagoon', background: 'linear-gradient(180deg, #5fd3d6 0%, #d3a9a0 100%)' },
  { id: 'flamingo', background: 'linear-gradient(135deg, #ff2d8e 0%, #ff4f80 100%)' },
  { id: 'ember', background: 'linear-gradient(135deg, #d9805f 0%, #f4160a 100%)' },
  {
    id: 'haze',
    background: 'radial-gradient(circle at 55% 35%, #f3c9bb 0%, #9fcfd2 70%, #bfe2e6 100%)',
  },
  {
    id: 'dusk',
    background:
      'radial-gradient(circle at 20% 90%, #d9a6e0 0%, transparent 45%), linear-gradient(135deg, #1e6fa8 0%, #8a4a6a 55%, #e8442a 100%)',
  },
  { id: 'orchid', background: 'linear-gradient(180deg, #6a4bc0 0%, #c23a6e 70%, #e0566a 100%)' },
  { id: 'harbor', background: 'linear-gradient(135deg, #2e5c8a 0%, #6d93ad 55%, #c9a98c 100%)' },
];

export const isGalleryCover = (banner: string) => banner.startsWith(GALLERY_PREFIX);

/** The CSS background of a gallery cover, or nothing when the id is not in the gallery. */
export function galleryBackground(banner: string): string | undefined {
  const id = banner.slice(GALLERY_PREFIX.length);
  return [...COLOURS, ...GRADIENTS].find((cover) => cover.id === id)?.background;
}
