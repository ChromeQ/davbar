import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  fetchImage,
  imageAddress,
  imageFile,
  isImageAddress,
  NOT_AN_IMAGE_ADDRESS,
} from './image-source';

const transfer = (data: Record<string, string>, files: File[] = []) => ({
  files,
  getData: (format: string) => data[format] ?? '',
});

const shopify = 'https://cdn.shopify.com/s/files/1/beer.png?v=1';

describe('image addresses', () => {
  it('accepts web addresses and data: images', () => {
    expect(isImageAddress(shopify)).toBe(true);
    expect(isImageAddress('http://192.168.0.10/beer.jpg')).toBe(true);
    expect(isImageAddress('data:image/png;base64,iVBORw0KGgo=')).toBe(true);
  });

  it('turns down anything else', () => {
    expect(isImageAddress('beer.png')).toBe(false);
    expect(isImageAddress('ftp://example.com/beer.png')).toBe(false);
    expect(isImageAddress('https://example.com/a beer.png')).toBe(false);
    expect(isImageAddress('data:text/html,<p>hi</p>')).toBe(false);
  });

  it("takes a dragged image's address from text/uri-list, skipping comments", () => {
    const dragged = transfer({
      'text/uri-list': `# from a page\r\n${shopify}\r\n`,
      'text/plain': 'x',
    });
    expect(imageAddress(dragged)).toBe(shopify);
  });

  it('takes a copied address from plain text, trimmed', () => {
    expect(imageAddress(transfer({ 'text/plain': `  ${shopify}\n` }))).toBe(shopify);
  });

  it('gives nothing for text that is not an address', () => {
    expect(imageAddress(transfer({ 'text/plain': 'Belgian Ale' }))).toBeNull();
  });
});

describe('copied pictures', () => {
  it('finds the image among the copied files', () => {
    const picture = new File(['png'], 'image.png', { type: 'image/png' });
    const text = new File(['hi'], 'notes.txt', { type: 'text/plain' });

    expect(imageFile(transfer({}, [text, picture]))).toBe(picture);
    expect(imageFile(transfer({}, [text]))).toBeNull();
  });
});

describe('fetchImage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('gives the image', async () => {
    const image = new Blob(['png'], { type: 'image/png' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(image)));

    expect((await fetchImage(shopify)).type).toBe('image/png');
  });

  it('explains a site that blocks other pages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

    await expect(fetchImage(shopify)).rejects.toThrow(/copy the image itself and paste it here/);
  });

  it('says what the site answered', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('gone', { status: 404 })));

    await expect(fetchImage(shopify)).rejects.toThrow(/status 404/);
  });

  it('turns down a page instead of an image', async () => {
    const page = new Blob(['<html></html>'], { type: 'text/html' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(page)));

    await expect(fetchImage(shopify)).rejects.toThrow(NOT_AN_IMAGE_ADDRESS);
  });
});
