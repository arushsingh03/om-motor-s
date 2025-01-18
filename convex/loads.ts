import dayjs from 'dayjs';
import { v } from 'convex/values';
import { mutation, query } from "../convex/_generated/server";

type UploadResult = {
  uploadUrl: string;
  storageId: string;
};

export const addLoad = mutation({
  args: {
    currentLocation: v.string(),
    destinationLocation: v.string(),
    weight: v.number(),
    weightUnit: v.union(v.literal('kg'), v.literal('ton')),
    truckLength: v.number(),
    lengthUnit: v.union(v.literal('m'), v.literal('ft')),
    contactNumber: v.string(),
    staffContactNumber: v.string(),
  },
  async handler(ctx, args) {
    const load = await ctx.db.insert('loads', {
      ...args,
      createdAt: dayjs().format('YYYY-MM-DD'),
    });
    return load;
  },
});

export const getTodayLoads = query({
  args: {},
  async handler(ctx) {
    return ctx.db
      .query('loads')
      .filter((q) =>
        q.eq(q.field('createdAt'), dayjs().format('YYYY-MM-DD'))
      )
      .collect();
  },
});

export const getLoads = query({
  args: {
    dateFrom: v.string(),
    dateTo: v.string(),
    location: v.string(),
  },
  async handler(ctx, args) {
    let query = ctx.db.query('loads');

    if (args.dateFrom && args.dateTo) {
      query = query.filter((q) =>
        q.and(
          q.gte(q.field('createdAt'), args.dateFrom),
          q.lte(q.field('createdAt'), args.dateTo)
        )
      );
    }

    if (args.location) {
      query = query.filter((q) =>
        q.or(
          q.eq(q.field('currentLocation'), args.location),
          q.eq(q.field('destinationLocation'), args.location)
        )
      );
    }

    return query.collect();
  },
});

const cleanStorageId = (storageId: string): string => {
  let cleaned = storageId;

  if (cleaned.includes('token=')) {
    cleaned = cleaned.split('token=')[1].split('&')[0];
  }

  if (cleaned.includes('/')) {
    cleaned = cleaned.split('/').pop() || cleaned;
  }

  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cleaned)) {
    return cleaned;
  }

  if (cleaned.length >= 32) {
    const uuid = cleaned.slice(0, 32).replace(
      /^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/,
      '$1-$2-$3-$4-$5'
    );
    return uuid;
  }

  throw new Error('Invalid storage ID format');
};

export const updateLoad = mutation({
  args: {
    loadId: v.id('loads'),
    currentLocation: v.string(),
    destinationLocation: v.string(),
    weight: v.number(),
    weightUnit: v.union(v.literal('kg'), v.literal('ton')),
    truckLength: v.number(),
    lengthUnit: v.union(v.literal('m'), v.literal('ft')),
    contactNumber: v.string(),
    staffContactNumber: v.string(),
  },
  async handler(ctx, args) {
    const { loadId, ...updateData } = args;
    const load = await ctx.db.get(loadId);

    if (!load) {
      throw new Error('Load not found');
    }

    await ctx.db.patch(loadId, updateData);
    return await ctx.db.get(loadId);
  },
});

export const generateStandaloneUploadUrl = mutation({
  args: {},
  async handler(ctx) {
    const url = await ctx.storage.generateUploadUrl();
    const storageId = url.split('/').pop()?.split('?')[0] || '';
    return {
      uploadUrl: url,
      storageId: storageId,
    };
  },
});

export const getNewReceipts = query({
  args: {
    lastCheckedAt: v.string(),
  },
  async handler(ctx, args) {
    const lastCheckedTime = dayjs(args.lastCheckedAt);
    return ctx.db
      .query('loads')
      .filter((q) =>
        q.and(
          q.neq(q.field('receiptStorageId'), undefined),
          q.gte(q.field('createdAt'), lastCheckedTime.format('YYYY-MM-DD HH:mm:ss'))
        )
      )
      .collect();
  },
});

export const generateUploadUrl = mutation({
  async handler(ctx) {
    try {
      const uploadUrl = await ctx.storage.generateUploadUrl();

      const url = new URL(uploadUrl);
      const storageId = url.searchParams.get('token');

      if (!storageId) {
        throw new Error('No storage ID found in upload URL');
      }

      console.log('Generated upload URL:', uploadUrl);
      console.log('Extracted storage ID:', storageId);

      return { uploadUrl, storageId };
    } catch (error) {
      console.error('Upload URL generation error:', error);
      throw new Error('Failed to generate upload URL: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  },
});

export const uploadReceipt = mutation({
  args: {
    loadId: v.id('loads'),
    storageId: v.string(),
  },
  async handler(ctx, args) {
    const load = await ctx.db.get(args.loadId);
    if (!load) {
      throw new Error('Load not found');
    }

    try {
      const cleanedStorageId = cleanStorageId(args.storageId);

      await ctx.db.patch(args.loadId, {
        receiptStorageId: cleanedStorageId
      });

      return await ctx.db.get(args.loadId);
    } catch (error) {
      console.error('Storage ID cleaning error:', error);
      throw new Error('Failed to process storage ID: ' +
        (error instanceof Error ? error.message : 'Unknown error'));
    }
  },
});


export const generateDownloadUrl = mutation({
  args: {
    storageId: v.string(),
  },
  async handler(ctx, args) {
    try {
      let storageId = args.storageId;

      if (!storageId.startsWith('kg')) {
        if (storageId.includes('/')) {
          storageId = storageId.split('/').pop() || storageId;
        }
        if (storageId.includes('?')) {
          storageId = storageId.split('?')[0];
        }
      }

      const downloadUrl = await ctx.storage.getUrl(storageId);

      if (!downloadUrl) {
        throw new Error('Failed to generate download URL');
      }

      return downloadUrl;
    } catch (error) {
      console.error('Download URL generation error:', error);
      throw new Error('Failed to generate download URL: ' +
        (error instanceof Error ? error.message : 'Unknown error'));
    }
  },
});


export const deleteLoad = mutation({
  args: {
    loadId: v.id('loads'),
  },
  async handler(ctx, args) {
    const load = await ctx.db.get(args.loadId);
    if (!load) {
      throw new Error('Load not found');
    }

    if (load.receiptStorageId) {
      try {
        const storageId = load.receiptStorageId.split('/').pop()?.split('?')[0];
        if (storageId) {
          await ctx.storage.delete(storageId);
        }
      } catch (error) {
        console.error('Storage deletion error:', error);
      }
    }

    await ctx.db.delete(args.loadId);
  },
});

export const saveStandaloneReceipt = mutation({
  args: {
    storageId: v.string(),
  },
  async handler(ctx, args) {
    const receiptData = await ctx.db.insert('receipts', {
      storageId: args.storageId,
      createdAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      type: 'standalone'
    });

    return {
      success: true,
      storageId: args.storageId,
      receiptData
    };
  },
});

export const getReceiptStorageIds = query({
  args: {},
  async handler(ctx) {
    const loads = await ctx.db
      .query('loads')
      .filter(q => q.neq(q.field('receiptStorageId'), undefined))
      .collect();

    const standaloneReceipts = await ctx.db
      .query('receipts')
      .collect();

    const loadReceipts = loads
      .filter(load => load.receiptStorageId)
      .map(load => ({
        storageId: load.receiptStorageId || '',
        createdAt: load.createdAt,
        type: 'load'
      }));

    const allReceipts = [
      ...loadReceipts,
      ...standaloneReceipts
    ].filter(item => item.storageId !== '');

    return allReceipts;
  },
});

export const deleteStandaloneReceipt = mutation({
  args: {
    storageId: v.string(),
  },
  async handler(ctx, args) {
    try {
      const actualStorageId = args.storageId.includes('token=')
        ? args.storageId.split('token=')[1].split('&')[0]
        : args.storageId;

      await ctx.storage.delete(actualStorageId);

      const loads = await ctx.db
        .query('loads')
        .filter(q => q.eq(q.field('receiptStorageId'), args.storageId))
        .collect();

      for (const load of loads) {
        await ctx.db.patch(load._id, {
          receiptStorageId: undefined
        });
      }

      const receipts = await ctx.db
        .query('receipts')
        .filter(q => q.eq(q.field('storageId'), args.storageId))
        .collect();

      for (const receipt of receipts) {
        await ctx.db.delete(receipt._id);
      }

      return { success: true };
    } catch (error: unknown) {
      console.error('Receipt deletion error:', error);
      throw new Error('Failed to delete receipt: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  },
});
