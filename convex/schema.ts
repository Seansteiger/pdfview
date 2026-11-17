import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  documents: defineTable({
    title: v.string(),
    storageId: v.id("_storage"),
    pageCount: v.number(),
    sizeBytes: v.number(),
    updatedAt: v.number(),
    annotationsCount: v.optional(v.number()),
    isStarred: v.optional(v.boolean()),
  }).index("by_updatedAt", ["updatedAt"]),
});
