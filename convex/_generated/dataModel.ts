import { GenericId } from "convex/values";
import { DataModelFromSchemaDefinition } from "convex/server";
import schema from "../schema";

export type DataModel = DataModelFromSchemaDefinition<typeof schema>;
export type Id<TableName extends string> = GenericId<TableName>;
export type Doc<TableName extends string> = any;
