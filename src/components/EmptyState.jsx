import React from 'react';

/** Shared empty-content anatomy. Status/error messages belong to their source. */
export default function EmptyState({ icon: Icon, title, description, actions, hint, size = 'panel', className = '', heading: Heading = 'h3', children, ...props }) {
  return <div {...props} className={`empty-state empty-state--${size} ${className}`}>
    <div className="empty-state__content">
      {Icon && <span className="empty-state__icon" aria-hidden="true">{React.isValidElement(Icon) ? Icon : <Icon strokeWidth={1.75} />}</span>}
      {title && <Heading className="empty-state__title">{title}</Heading>}
      {description && <p className="empty-state__description">{description}</p>}
      {children && <div className="empty-state__details">{children}</div>}
      {actions && <div className="empty-state__actions">{actions}</div>}
      {hint && <span className="empty-state__hint">{hint}</span>}
    </div>
  </div>;
}
