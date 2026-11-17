import {
  mutationGeneric,
  queryGeneric,
  actionGeneric,
  GenericDatabaseReader,
  GenericDatabaseWriter,
  StorageWriter,
  StorageReader,
} from "convex/server";
import { DataModel } from "./dataModel";

export interface QueryCtx {
  db: GenericDatabaseReader<DataModel>;
  storage: StorageReader;
  auth: any;
}

export interface MutationCtx {
  db: GenericDatabaseWriter<DataModel>;
  storage: StorageWriter;
  auth: any;
}

export const query = queryGeneric;
export const mutation = mutationGeneric;
export const action = actionGeneric;
export const internalMutation = mutationGeneric;
export const internalQuery = queryGeneric;
export const internalAction = actionGeneric;
