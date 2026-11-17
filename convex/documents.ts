import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Generates a single-use short-lived POST URL for client direct binary uploads to Convex storage.
 */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Creates or updates a document record in Convex, linking to its uploaded storage binary.
 */
export const saveDocument = mutation({
  args: {
    id: v.optional(v.id("documents")),
    title: v.string(),
    storageId: v.id("_storage"),
    pageCount: v.number(),
    sizeBytes: v.number(),
    annotationsCount: v.optional(v.number()),
    isStarred: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    if (args.id) {
      const existing = await ctx.db.get(args.id);
      if (existing && existing.storageId !== args.storageId) {
        // Clean up previously orphaned storage binary
        await ctx.storage.delete(existing.storageId);
      }
      await ctx.db.patch(args.id, {
        title: args.title,
        storageId: args.storageId,
        pageCount: args.pageCount,
        sizeBytes: args.sizeBytes,
        annotationsCount: args.annotationsCount,
        isStarred: args.isStarred,
        updatedAt: now,
      });
      return args.id;
    } else {
      return await ctx.db.insert("documents", {
        title: args.title,
        storageId: args.storageId,
        pageCount: args.pageCount,
        sizeBytes: args.sizeBytes,
        annotationsCount: args.annotationsCount,
        isStarred: args.isStarred ?? false,
        updatedAt: now,
      });
    }
  },
});

/**
 * Queries all cloud-synced documents sorted by latest update, resolving each document's download URL.
 */
export const listDocuments = query({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db
      .query("documents")
      .withIndex("by_updatedAt")
      .order("desc")
      .collect();

    return await Promise.all(
      docs.map(async (doc) => {
        const downloadUrl = await ctx.storage.getUrl(doc.storageId);
        return {
          ...doc,
          downloadUrl,
        };
      })
    );
  },
});

/**
 * Deletes a document record and purges its binary file from Convex file storage.
 */
export const deleteDocument = mutation({
  args: {
    id: v.id("documents"),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.id);
    if (doc) {
      await ctx.storage.delete(doc.storageId);
      await ctx.db.delete(args.id);
    }
  },
});

/**
 * Toggles the starred status of a cloud document.
 */
export const toggleStar = mutation({
  args: {
    id: v.id("documents"),
  },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.id);
    if (doc) {
      await ctx.db.patch(args.id, {
        isStarred: !doc.isStarred,
      });
    }
  },
});
