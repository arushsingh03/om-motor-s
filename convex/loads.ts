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

export const generateUploadUrl = mutation({
  async handler(ctx) {
    try {
      const uploadUrl = await ctx.storage.generateUploadUrl();
      console.log('Generated upload URL:', uploadUrl);

      const storageId = uploadUrl.split('?')[0].split('/').pop() || '';
      console.log('Extracted storage ID:', storageId);

      if (!storageId || !/^[\w-]{36,}$/.test(storageId)) {
        console.error('Invalid storage ID extracted:', storageId);
        throw new Error('Invalid storage ID extracted during upload.');
      }

      return { uploadUrl, storageId };
    } catch (error) {
      console.error('Upload URL generation error:', error);
      throw new Error('Failed to generate upload URL.');
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

    console.log('Updating load with storage ID:', args.storageId);

    await ctx.db.patch(args.loadId, {
      receiptStorageId: args.storageId,
    });
    return load;
  },
});


export const generateDownloadUrl = mutation({
  args: {
    storageId: v.string(),
  },
  async handler(ctx, args) {
    try {
      console.log('Generating download URL for storage ID:', args.storageId);

      const cleanStorageId = args.storageId.split('?')[0].split('/').pop() || '';
      console.log('Cleaned storage ID:', cleanStorageId);

      if (!cleanStorageId ||
        cleanStorageId === 'upload' ||
        cleanStorageId.length < 32 ||
        !/^[0-9a-f-]+$/i.test(cleanStorageId)) {
        console.error('Invalid storage ID provided:', cleanStorageId);
        throw new Error(`Invalid storage ID format: ${cleanStorageId}`);
      }

      const downloadUrl = await ctx.storage.getUrl(cleanStorageId);
      console.log('Generated download URL:', downloadUrl);

      if (!downloadUrl) {
        throw new Error('Failed to generate download URL: Empty URL returned');
      }

      return downloadUrl;
    } catch (error) {
      console.error('Download URL generation error:', error);

      if (error instanceof Error) {
        if (error.message.includes('Invalid storage ID')) {
          throw new Error(`Invalid storage ID format: ${args.storageId}`);
        } else if (error.message.includes('not found')) {
          throw new Error(`File not found for storage ID: ${args.storageId}`);
        }
      }

      throw new Error('Failed to generate download URL. Please ensure the file exists and the storage ID is valid.');
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
        const actualStorageId = load.receiptStorageId.includes('token=')
          ? load.receiptStorageId.split('token=')[1]
          : load.receiptStorageId;

        await ctx.storage.delete(actualStorageId);
      } catch (error) {
        console.error('Storage deletion error:', error);
      }
    }

    await ctx.db.delete(args.loadId);
  },
});

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

export const saveStandaloneReceipt = mutation({
  args: {
    storageId: v.string(),
  },
  async handler(ctx, args) {
    const receiptData = {
      storageId: args.storageId,
      uploadTime: dayjs().format('YYYY-MM-DD HH:mm:ss')
    };

    return {
      success: true,
      storageId: args.storageId
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

      return { success: true };
    } catch (error: unknown) {
      console.error('Receipt deletion error:', error);
      if (error instanceof Error) {
        throw new Error('Failed to delete receipt: ' + error.message);
      } else {
        throw new Error('Failed to delete receipt: Unknown error');
      }
    }
  },
});

export const getReceiptStorageIds = query({
  args: {},
  async handler(ctx) {
    const loads = await ctx.db
      .query('loads')
      .filter(q => q.neq(q.field('receiptStorageId'), undefined))
      .collect();

    return loads.map(load => ({
      storageId: load.receiptStorageId || '',
      createdAt: load.createdAt
    })).filter(item => item.storageId !== '');
  },
});
