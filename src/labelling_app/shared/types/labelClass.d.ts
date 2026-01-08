import type { Timestamp } from 'firebase/firestore';
/**
 * Label class representing a category of objects to annotate
 */
export interface LabelClass {
    id: string;
    name: string;
    color: string;
    order: number;
    createdAt: Timestamp;
}
/**
 * Label class creation payload
 */
export interface CreateLabelClassInput {
    name: string;
    color: string;
}
/**
 * Label class update payload
 */
export interface UpdateLabelClassInput {
    name?: string;
    color?: string;
    order?: number;
}
//# sourceMappingURL=labelClass.d.ts.map