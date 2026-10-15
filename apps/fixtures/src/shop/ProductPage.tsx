import type { Product } from './data';

export function ProductPage({ product }: { product: Product }) {
  return (
    <main className="product-page">
      <a href="/">← Back to phones</a>
      <div className="product-page__image" aria-hidden="true">
        {product.name.slice(0, 1)}
      </div>
      <p className="eyebrow">
        {product.color} · {product.storage}
      </p>
      <h1>{product.name}</h1>
      <p className="price">${product.price}</p>
      <p>
        This fixture stops before checkout. Nudge can inspect this page but cannot make a purchase.
      </p>
      <button type="button">Add to bag</button>
    </main>
  );
}
