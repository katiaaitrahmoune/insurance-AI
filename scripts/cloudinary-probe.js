import 'dotenv/config';
import { v2 as cloudinary } from 'cloudinary';

const { CLOUDINARY_CLOUD_NAME: cloud_name, CLOUDINARY_API_KEY: api_key, CLOUDINARY_API_SECRET: api_secret } = process.env;
cloudinary.config({ cloud_name, api_key, api_secret, secure: true });

const res = await cloudinary.uploader.upload(
  `data:text/plain;base64,${Buffer.from('hello').toString('base64')}`,
  { resource_type: 'raw', type: 'upload', folder: 'insuralens/probe', public_id: `probe-${Date.now()}.txt` },
);
console.log({ public_id: res.public_id, asset_folder: res.asset_folder, secure_url: res.secure_url });