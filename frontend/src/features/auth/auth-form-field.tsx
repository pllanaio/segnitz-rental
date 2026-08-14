'use client';

import type { InputHTMLAttributes } from 'react';
import styles from './auth.module.css';

type FieldWidth = 'full' | 'half' | 'third' | 'twoThirds';

interface AuthFormFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'id'> {
  error?: string;
  help?: string;
  id: string;
  label: string;
  width?: FieldWidth;
}

const widthClasses: Record<FieldWidth, string> = {
  full: styles.fieldFull,
  half: styles.fieldHalf,
  third: styles.fieldThird,
  twoThirds: styles.fieldTwoThirds,
};

export function AuthFormField({
  error,
  help,
  id,
  label,
  name = id,
  required,
  width = 'full',
  ...inputProps
}: Readonly<AuthFormFieldProps>) {
  const feedbackId = `${id}Feedback`;
  const helpId = `${id}Help`;
  const describedBy = [error ? feedbackId : '', help ? helpId : ''].filter(Boolean).join(' ') || undefined;

  return (
    <div className={widthClasses[width]}>
      <label className={styles.label} htmlFor={id}>
        {label}
        {required ? (
          <>
            <span aria-hidden="true" className={styles.requiredMarker}>*</span>
            <span className={styles.srOnly}> (Pflichtfeld)</span>
          </>
        ) : null}
      </label>
      <input
        {...inputProps}
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        className={`${styles.input} ${error ? styles.inputInvalid : ''}`}
        id={id}
        name={name}
        required={required}
      />
      {help ? <p className={styles.fieldHelp} id={helpId}>{help}</p> : null}
      {error ? <p className={styles.fieldError} id={feedbackId}>{error}</p> : null}
    </div>
  );
}
