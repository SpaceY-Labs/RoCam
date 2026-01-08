import { z } from 'zod';
/**
 * Single mask creation schema
 */
export declare const createMaskSchema: z.ZodObject<{
    classId: z.ZodString;
    data: z.ZodObject<{
        type: z.ZodLiteral<"polygon">;
        polygon: z.ZodArray<z.ZodArray<z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            x: number;
            y: number;
        }, {
            x: number;
            y: number;
        }>, "many">, "many">;
    }, "strip", z.ZodTypeAny, {
        polygon: {
            x: number;
            y: number;
        }[][];
        type: "polygon";
    }, {
        polygon: {
            x: number;
            y: number;
        }[][];
        type: "polygon";
    }>;
    boundingBox: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        w: z.ZodNumber;
        h: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        x: number;
        y: number;
        w: number;
        h: number;
    }, {
        x: number;
        y: number;
        w: number;
        h: number;
    }>;
    area: z.ZodNumber;
    source: z.ZodEnum<["sam3_auto", "sam3_click", "sam3_semantic", "manual"]>;
}, "strip", z.ZodTypeAny, {
    data: {
        polygon: {
            x: number;
            y: number;
        }[][];
        type: "polygon";
    };
    classId: string;
    boundingBox: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    area: number;
    source: "sam3_auto" | "sam3_click" | "sam3_semantic" | "manual";
}, {
    data: {
        polygon: {
            x: number;
            y: number;
        }[][];
        type: "polygon";
    };
    classId: string;
    boundingBox: {
        x: number;
        y: number;
        w: number;
        h: number;
    };
    area: number;
    source: "sam3_auto" | "sam3_click" | "sam3_semantic" | "manual";
}>;
/**
 * Bulk save masks schema (replaces all masks for image)
 */
export declare const saveMasksSchema: z.ZodObject<{
    masks: z.ZodArray<z.ZodObject<{
        classId: z.ZodString;
        data: z.ZodObject<{
            type: z.ZodLiteral<"polygon">;
            polygon: z.ZodArray<z.ZodArray<z.ZodObject<{
                x: z.ZodNumber;
                y: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                x: number;
                y: number;
            }, {
                x: number;
                y: number;
            }>, "many">, "many">;
        }, "strip", z.ZodTypeAny, {
            polygon: {
                x: number;
                y: number;
            }[][];
            type: "polygon";
        }, {
            polygon: {
                x: number;
                y: number;
            }[][];
            type: "polygon";
        }>;
        boundingBox: z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
            w: z.ZodNumber;
            h: z.ZodNumber;
        }, "strip", z.ZodTypeAny, {
            x: number;
            y: number;
            w: number;
            h: number;
        }, {
            x: number;
            y: number;
            w: number;
            h: number;
        }>;
        area: z.ZodNumber;
        source: z.ZodEnum<["sam3_auto", "sam3_click", "sam3_semantic", "manual"]>;
    }, "strip", z.ZodTypeAny, {
        data: {
            polygon: {
                x: number;
                y: number;
            }[][];
            type: "polygon";
        };
        classId: string;
        boundingBox: {
            x: number;
            y: number;
            w: number;
            h: number;
        };
        area: number;
        source: "sam3_auto" | "sam3_click" | "sam3_semantic" | "manual";
    }, {
        data: {
            polygon: {
                x: number;
                y: number;
            }[][];
            type: "polygon";
        };
        classId: string;
        boundingBox: {
            x: number;
            y: number;
            w: number;
            h: number;
        };
        area: number;
        source: "sam3_auto" | "sam3_click" | "sam3_semantic" | "manual";
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    masks: {
        data: {
            polygon: {
                x: number;
                y: number;
            }[][];
            type: "polygon";
        };
        classId: string;
        boundingBox: {
            x: number;
            y: number;
            w: number;
            h: number;
        };
        area: number;
        source: "sam3_auto" | "sam3_click" | "sam3_semantic" | "manual";
    }[];
}, {
    masks: {
        data: {
            polygon: {
                x: number;
                y: number;
            }[][];
            type: "polygon";
        };
        classId: string;
        boundingBox: {
            x: number;
            y: number;
            w: number;
            h: number;
        };
        area: number;
        source: "sam3_auto" | "sam3_click" | "sam3_semantic" | "manual";
    }[];
}>;
export type CreateMaskInput = z.infer<typeof createMaskSchema>;
export type SaveMasksInput = z.infer<typeof saveMasksSchema>;
//# sourceMappingURL=mask.schema.d.ts.map