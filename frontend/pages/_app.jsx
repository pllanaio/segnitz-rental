import Head from 'next/head';
import 'flatpickr/dist/flatpickr.min.css';
import { installCsrfFetch } from '../lib/csrf';
import { getBootstrap } from '../lib/bootstrap';

if (typeof window !== 'undefined') {
    installCsrfFetch(window);
    getBootstrap();
}

export default function SegnitzRentalApp({ Component, pageProps }) {
    return (
        <>
            <Head>
                <meta name="viewport" content="width=device-width, initial-scale=1" />
            </Head>
            <Component {...pageProps} />
        </>
    );
}
