import Image from 'next/image';
import { Icon } from '@/components/ui/icon';
import type { Product } from '@/lib/api/types';
import { formatCurrency, imageSource } from '@/lib/format';
import styles from './shop.module.css';

export function ProductCard({ product, featured = false, onSelect }: {
  product: Product;
  featured?: boolean;
  onSelect: (product: Product) => void;
}) {
  return (
    <article className={styles.productCard}>
      <button
        aria-label={`${product.title} ansehen`}
        className={styles.productImageButton}
        onClick={() => onSelect(product)}
        type="button"
      >
        {featured ? <span className={styles.featuredTag}>Beliebt</span> : null}
        <Image
          alt={product.title}
          className={styles.productImage}
          height={420}
          src={imageSource(product.imagePath)}
          unoptimized
          width={560}
        />
      </button>
      <div className={styles.productCardBody}>
        <div className={styles.productMeta}>
          <span>{product.categories.map((category) => category.name).join(' · ') || 'Mietartikel'}</span>
          {product.reviewCount > 0 ? (
            <span className={styles.rating}><Icon name="star" size={15} /> {product.rating.toFixed(1)} ({product.reviewCount})</span>
          ) : null}
        </div>
        <h3>{product.title}</h3>
        <p>{product.description || 'Weitere Informationen erhalten Sie in der Produktansicht.'}</p>
        <div className={styles.productFooter}>
          <div><strong>{formatCurrency(product.pricePerDay)}</strong><span> pro Tag</span></div>
          <button className="button" onClick={() => onSelect(product)} type="button">Auswählen</button>
        </div>
      </div>
    </article>
  );
}

