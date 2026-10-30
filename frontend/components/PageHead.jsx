import Head from 'next/head';

export default function PageHead({ title, referrer, robots, noStore, children }) {
    return (
        <Head>
            <title>{title}</title>
            {referrer ? <meta name="referrer" content={referrer} /> : null}
            {robots ? <meta name="robots" content={robots} /> : null}
            {noStore ? <meta httpEquiv="Cache-Control" content="no-store" /> : null}
            {children}
        </Head>
    );
}
