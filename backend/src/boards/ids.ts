import { z } from "zod";

export const DEFAULT_BOARD_ID = "00000000-0000-0000-0000-000000000001";
export const BoardIdSchema = z.union([z.string().uuid(), z.literal(DEFAULT_BOARD_ID)]);

