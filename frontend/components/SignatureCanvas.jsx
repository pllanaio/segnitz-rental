import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

// Wraps signature_pad 2.3.2 (the version the plain-JS checkout used) with the same
// pen settings and the same resize behaviour that keeps drawn strokes.
const SignatureCanvas = forwardRef(function SignatureCanvas({ visible = true }, ref) {
    const canvasRef = useRef(null);
    const padRef = useRef(null);

    const resizeCanvas = () => {
        const canvas = canvasRef.current;
        const signaturePad = padRef.current;
        if (!canvas || !signaturePad) return;

        const oldContent = signaturePad.toData();
        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        canvas.width = canvas.offsetWidth * ratio;
        canvas.height = canvas.offsetHeight * ratio;
        canvas.getContext('2d').scale(ratio, ratio);
        signaturePad.clear();
        signaturePad.fromData(oldContent);
    };

    useEffect(() => {
        // eslint-disable-next-line global-require
        const SignaturePad = require('signature_pad');
        const PadConstructor = SignaturePad.default || SignaturePad;
        const signaturePad = new PadConstructor(canvasRef.current);
        signaturePad.minWidth = 1;
        signaturePad.maxWidth = 5;
        signaturePad.penColor = '#000000';
        signaturePad.backgroundColor = '#FFFFFF';
        padRef.current = signaturePad;

        window.addEventListener('resize', resizeCanvas);
        resizeCanvas();

        return () => {
            window.removeEventListener('resize', resizeCanvas);
            signaturePad.off();
            padRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (visible) window.setTimeout(resizeCanvas, 0);
    }, [visible]);

    useImperativeHandle(ref, () => ({
        isEmpty: () => padRef.current?.isEmpty() ?? true,
        clear: () => padRef.current?.clear(),
        toDataURL: (...args) => padRef.current?.toDataURL(...args) ?? '',
        resize: resizeCanvas,
        canvas: () => canvasRef.current,
        pad: () => padRef.current
    }), []);

    return <canvas ref={canvasRef} />;
});

export default SignatureCanvas;
