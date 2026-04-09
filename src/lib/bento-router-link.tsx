import { makeLinkComponent } from '@buildo/bento-design-system'
import { Link as RouterLink } from 'react-router-dom'

/** Bento `ButtonLink` / `Link` use `href`; React Router uses `to`. */
export const BentoRouterLink = makeLinkComponent((props, ref) => {
  const { href, ...rest } = props
  return <RouterLink ref={ref} to={href} {...rest} />
})
