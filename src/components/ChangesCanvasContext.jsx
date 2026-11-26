import React from 'react';

/**
 * Shared canvas ownership contract for the changes review companion.
 * @type {React.Context<{
 *   host: HTMLElement|null,
 *   expandedHost: HTMLElement|null,
 *   activeId: string|null,
 *   expandedId: string|null,
 *   placement: {left:number,top:number,width:number,height:number}|null,
 *   open: (nodeId:string) => void,
 *   close: (nodeId:string) => void,
 *   expand: (nodeId:string) => void,
 *   restore: (nodeId:string) => void
 * }|null>}
 */
export const ChangesCanvasContext = React.createContext(null);
