import { createProvider } from './config.js';
import { prepareUpload } from '../lib/uploads/prepareUpload.js';

const provider = createProvider('photo');

/** Every caller prepares bytes before the server's strict size/type gate. */
export const uploadPhoto = async (file, options) => {
 const prepared = await prepareUpload(file, options);
 const uploader = await provider();
 options?.signal?.throwIfAborted();
 return uploader.uploadPhoto(prepared, options);
};
