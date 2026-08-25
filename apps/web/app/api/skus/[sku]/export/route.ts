import { type NextRequest, NextResponse } from 'next/server';
import { loadSkuPage } from '@/lib/catalog';
import { mediaUrl } from '@/lib/media';

export const dynamic = 'force-dynamic';

export async function GET(_req: NextRequest, ctx: { params: Promise<{ sku: string }> }) {
  const { sku: skuCode } = await ctx.params;
  const data = await loadSkuPage(skuCode);
  if (!data) {
    return NextResponse.json({ error: 'SKU not found' }, { status: 404 });
  }

  const origin = _req.nextUrl.origin;
  const glbUrl = `${origin}/3d/${data.sku.code}.glb`;

  const exportData = {
    schema_version: '1.0.0',
    exported_at: new Date().toISOString(),
    product: {
      sku_code: data.sku.code,
      name: data.product.name,
      variant: data.sku.variant,
      full_title: `${data.brand.name} ${data.product.name} ${data.sku.variant || ''}`.trim(),
      model_number: data.product.modelNo,
      brand: {
        name: data.brand.name,
        slug: data.brand.slug,
        official_domains: data.brand.domains,
      },
      category: {
        slug: data.category.slug,
        name: data.category.name,
        canonical_unit: data.category.unit,
      },
      commercial: {
        mrp_inr: data.sku.mrp,
        selling_price_inr: data.sku.price,
        gst_rate_pct: data.sku.gstRate,
        stock_status: data.sku.stock,
        rating: data.sku.rating,
      },
      descriptions: {
        short: data.sku.short,
        detailed: data.sku.long,
      },
    },
    specifications: {
      key_specs: data.sku.keySpecs,
      technical_attributes: data.sku.specJson,
      physical_dimensions_mm: data.dims
        ? {
            width_mm: data.dims.w,
            height_mm: data.dims.h,
            depth_mm: data.dims.d,
          }
        : null,
    },
    assets_3d: {
      scale: '1:1 true real-world scale (1 unit = 1 meter)',
      bounding_box_mm: data.dims ? [data.dims.w, data.dims.h, data.dims.d] : null,
      formats: {
        glb: glbUrl,
        export_endpoint: `${origin}/api/export/3d/${data.sku.code}`,
      },
      ar_integration: {
        room_ar_url: `${origin}/ar/${data.sku.code.toLowerCase()}`,
        supported_devices: ['WebXR (Android / Chrome)', 'AR QuickLook (iOS / Safari)', 'SceneViewer'],
      },
    },
    media: {
      image_count: data.images.length,
      images: data.images.map((img) => ({
        position: img.position,
        role: img.role,
        alt: img.alt,
        width: img.width,
        height: img.height,
        blurhash: img.blurhash,
        renditions: {
          zoom_2048: mediaUrl(img.zoom) ? origin + mediaUrl(img.zoom) : null,
          gallery_1200: mediaUrl(img.gallery) ? origin + mediaUrl(img.gallery) : null,
          card_600: mediaUrl(img.card) ? origin + mediaUrl(img.card) : null,
          thumb_200: mediaUrl(img.thumb) ? origin + mediaUrl(img.thumb) : null,
        },
      })),
      documents: data.documents.map((doc) => ({
        id: doc.id,
        type: doc.type,
        title: doc.title,
        pages: doc.pages,
        size_kb: doc.sizeKb,
        source_url: doc.sourceUrl,
      })),
    },
  };

  return NextResponse.json(exportData, {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=86400',
    },
  });
}
