import { getImage as getImageModel } from '../../models/image.model.js';
import { NotFoundError } from '../../utils/errors.js';
import { Image } from 'shared';

export async function getImage(projectId: string, imageId: string): Promise<Image> {
  const image = await getImageModel(projectId, imageId);
  if (!image) {
    throw new NotFoundError('Image', imageId);
  }
  return image;
}




