export interface Product {
  id: string;
  name: string;
  color: string;
  storage: string;
  price: number;
}

export const products: Product[] = [
  { id: 'iphone-16-black-128', name: 'iPhone 16', color: 'Black', storage: '128 GB', price: 799 },
  { id: 'iphone-16-black-256', name: 'iPhone 16', color: 'Black', storage: '256 GB', price: 899 },
  {
    id: 'iphone-16-pro-black-256',
    name: 'iPhone 16 Pro',
    color: 'Black',
    storage: '256 GB',
    price: 1099,
  },
  { id: 'iphone-16-white-256', name: 'iPhone 16', color: 'White', storage: '256 GB', price: 899 },
  { id: 'pixel-9-black-256', name: 'Pixel 9', color: 'Black', storage: '256 GB', price: 749 },
];
