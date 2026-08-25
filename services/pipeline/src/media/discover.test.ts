import { describe, expect, it } from 'vitest';
import { type BrandDomains, discoverImages, fullSizeVariants, isRivalHost } from './discover';

/**
 * The rules here are the ones that decide whether a buyer sees UltraTech's bag or Ambuja's, so
 * they are tested against the actual URLs that were wrong in the catalogue.
 */

const BRANDS: BrandDomains[] = [
  { slug: 'ultratech', domains: ['ultratechcement.com'] },
  { slug: 'ambuja', domains: ['ambujacement.com', 'ambujahelp.in'] },
  { slug: 'acc', domains: ['acclimited.com', 'acchelp.in'] },
  { slug: 'somany', domains: ['somanyceramics.com'] },
  { slug: 'kajaria', domains: ['kajariaceramics.com'] },
  { slug: 'leica', domains: ['leica-geosystems.com', 'hexagon.com'] },
  { slug: 'topcon', domains: ['topconpositioning.com'] },
];

describe('isRivalHost', () => {
  it('names the competitor when an image is served from their domain', () => {
    // Every UltraTech image in the shipped catalogue pointed here.
    expect(isRivalHost('https://www.ambujahelp.in/-/media/Ambuja-Plus2x-new.ashx', 'ultratech', BRANDS)).toBe('ambuja');
    expect(isRivalHost('https://www.kajariaceramics.com/storage/product/GP00215_b.jpg', 'somany', BRANDS)).toBe('kajaria');
    expect(isRivalHost('https://leica-geosystems.com/-/media/800x428_thumb.jpg', 'topcon', BRANDS)).toBe('leica');
  });

  it('allows a brand its own domain, with or without www, and its subdomains', () => {
    expect(isRivalHost('https://www.ultratechcement.com/content/x.jpg', 'ultratech', BRANDS)).toBeNull();
    expect(isRivalHost('https://ultratechcement.com/content/x.jpg', 'ultratech', BRANDS)).toBeNull();
    expect(isRivalHost('https://shop.somanyceramics.com/x.jpg', 'somany', BRANDS)).toBeNull();
  });

  it('allows a second domain the same brand owns', () => {
    expect(isRivalHost('https://www.acchelp.in/x.jpg', 'acc', BRANDS)).toBeNull();
    expect(isRivalHost('https://hexagon.com/x.jpg', 'leica', BRANDS)).toBeNull();
  });

  it('allows a dealer or a CDN — not the brand, but not a competitor either', () => {
    expect(isRivalHost('https://cdn.shopify.com/s/files/1/x.jpg', 'somany', BRANDS)).toBeNull();
    expect(isRivalHost('https://cdn11.bigcommerce.com/s-x/products/1.jpg', 'ultratech', BRANDS)).toBeNull();
  });

  it('does not mistake a domain that merely ends in the same letters', () => {
    expect(isRivalHost('https://notambujahelp.in/x.jpg', 'ultratech', BRANDS)).toBeNull();
  });

  it('treats an unparseable URL as not a rival rather than throwing', () => {
    expect(isRivalHost('not a url', 'ultratech', BRANDS)).toBeNull();
  });
});

describe('fullSizeVariants', () => {
  it('strips a Wix resize so the original comes back instead of a 49px thumbnail', () => {
    const thumb = 'https://static.wixstatic.com/media/cf66d3_b15294~mv2.png/v1/fill/w_49,h_49,al_c,q_85/file.png';
    expect(fullSizeVariants(thumb)[0]).toBe('https://static.wixstatic.com/media/cf66d3_b15294~mv2.png');
  });

  it('strips a Shopify size suffix and its width query', () => {
    expect(fullSizeVariants('https://cdn.shopify.com/s/files/1/x/bulb_1024x1024.jpg?width=200')[0]).toBe('https://cdn.shopify.com/s/files/1/x/bulb.jpg');
  });

  it('drops the resize query on Contentful and BigCommerce', () => {
    expect(fullSizeVariants('https://images.ctfassets.net/a/b/c/geo-c5.png?w=400&h=300')[0]).toBe('https://images.ctfassets.net/a/b/c/geo-c5.png');
  });

  it('strips a WordPress crop written into the filename', () => {
    expect(fullSizeVariants('https://www.aisglass.com/wp-content/uploads/2025/05/AIS-Edge-300x200.jpg')[0]).toBe(
      'https://www.aisglass.com/wp-content/uploads/2025/05/AIS-Edge.jpg',
    );
  });

  it('strips a thumbnail suffix so the original is tried first', () => {
    // Dahua serve this as 8.9 KB with the suffix and 1.4 MB without it.
    expect(fullSizeVariants('https://materialfile.dahuasecurity.com/a/ProductImage/1_0_99_thumb.JPG')[0]).toBe(
      'https://materialfile.dahuasecurity.com/a/ProductImage/1_0_99.JPG',
    );
    expect(fullSizeVariants('https://example.com/a/photo-small.jpg')[0]).toBe('https://example.com/a/photo.jpg');
  });

  it('does not strip a word that merely ends in the same letters', () => {
    expect(fullSizeVariants('https://example.com/a/thumbsmall.jpg')).toEqual(['https://example.com/a/thumbsmall.jpg']);
  });

  it('always ends with the URL as written, so a CDN that dislikes the rewrite still gets a turn', () => {
    const url = 'https://static.wixstatic.com/media/x~mv2.png/v1/fill/w_49,h_49/file.png';
    expect(fullSizeVariants(url).at(-1)).toBe(url);
  });

  it('returns just the URL when no rule applies', () => {
    expect(fullSizeVariants('https://example.com/a.jpg')).toEqual(['https://example.com/a.jpg']);
  });
});

describe('discoverImages', () => {
  const base = {
    pageUrl: 'https://www.ultratechcement.com/products/ppc',
    brandSlug: 'ultratech',
    brandName: 'UltraTech Cement',
    productName: 'UltraTech Portland Pozzolana Cement (PPC)',
    modelNo: 'PPC50',
    brands: BRANDS,
  };

  it('refuses a competitor, a stock library and a marketplace, whatever the page says', () => {
    const html = `
      <meta property="og:image" content="https://www.ambujahelp.in/-/media/bag.jpg">
      <img src="https://images.unsplash.com/photo-123">
      <img src="https://5.imimg.com/data5/x/cement.jpg">
      <img src="/content/dam/ultratechcement/ppc-bag.jpg">`;
    const found = discoverImages({ ...base, html });
    expect(found.map((c) => c.url)).toEqual(['https://www.ultratechcement.com/content/dam/ultratechcement/ppc-bag.jpg']);
  });

  it('ranks a filename that names the product above one that does not', () => {
    const html = `
      <img src="/content/dam/generic-hero.jpg">
      <img src="/content/dam/ultratech-ppc-cement-bag.jpg">`;
    const [first] = discoverImages({ ...base, html });
    expect(first.url).toContain('ultratech-ppc-cement-bag');
    expect(first.why.join(' ')).toContain('filename matches');
  });

  it('credits the image the page nominates as its own subject', () => {
    const html = '<meta property="og:image" content="/content/dam/hero.jpg"><img src="/content/dam/other.jpg">';
    const [first] = discoverImages({ ...base, html });
    expect(first.origin).toBe('og');
    expect(first.why.join(' ')).toContain('names it as its subject');
  });

  it('drops page furniture — logos, icons, social marks and vectors', () => {
    const html = `
      <img src="/content/dam/newLogo.png">
      <img src="/content/dam/icon-1.svg">
      <img src="/content/dam/whatsapp.png">
      <img src="/content/dam/ppc-bag.jpg">`;
    expect(discoverImages({ ...base, html }).map((c) => c.url)).toEqual(['https://www.ultratechcement.com/content/dam/ppc-bag.jpg']);
  });

  it('takes the widest entry of a srcset rather than the default src', () => {
    const html = '<img src="/dam/small.jpg" srcset="/dam/small.jpg 400w, /dam/large.jpg 1600w">';
    expect(discoverImages({ ...base, html }).some((c) => c.url.endsWith('/dam/large.jpg'))).toBe(true);
  });

  it('reads a lazy-loaded URL out of its data attribute', () => {
    const html = '<img src="data:image/gif;base64,R0lGOD" data-src="/dam/ppc-bag.jpg">';
    expect(discoverImages({ ...base, html }).map((c) => c.url)).toContain('https://www.ultratechcement.com/dam/ppc-bag.jpg');
  });

  it('survives malformed JSON-LD and still returns the img tags', () => {
    const html = '<script type="application/ld+json">{ not json </script><img src="/dam/ppc-bag.jpg">';
    expect(discoverImages({ ...base, html })).toHaveLength(1);
  });

  it('finds an image declared in JSON-LD', () => {
    const html = '<script type="application/ld+json">{"@type":"Product","image":["/dam/ld-bag.jpg"]}</script>';
    const [first] = discoverImages({ ...base, html });
    expect(first.url).toBe('https://www.ultratechcement.com/dam/ld-bag.jpg');
    expect(first.origin).toBe('json_ld');
  });

  it('penalises a URL that admits it is small', () => {
    const html = '<img src="/dam/ppc-a.jpg?w=120"><img src="/dam/ppc-b.jpg?w=2000">';
    const [first] = discoverImages({ ...base, html });
    expect(first.url).toContain('ppc-b');
  });
});
