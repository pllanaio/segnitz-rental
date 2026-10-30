export default function Preloader({ visible = false }) {
    return (
        <div id="preloader-wrapper" className={visible ? 'd-block' : undefined}>
            <div id="preloader" />
            <div className="preloader-section section-left" />
            <div className="preloader-section section-right" />
        </div>
    );
}
